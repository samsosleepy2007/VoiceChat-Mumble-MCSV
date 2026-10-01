import {
  world,
  system,
  ItemStack,
  ItemLockMode,
  EntityComponentTypes,
  EquipmentSlot,
  PlayerPermissionLevel,
} from "@minecraft/server";
import {
  CustomForm,
  ObservableBoolean,
  ObservableNumber,
  ObservableString,
} from "@minecraft/server-ui";

// Keep the original VoiceCraft item identifiers so existing worlds upgrade
// without losing the Mic item. Server integration is VC Mumble native.
const MIC_OFF = "voicecraft:mic_off";
const MIC_ON = "voicecraft:mic_on";
const LEGACY_HOLD = "voicecraft:mic_hold";
const LEGACY_TOGGLE = "voicecraft:mic_toggle";

const PHONE = "voicecraft:phone";

// Phone identity lives on the non-stackable ItemStack. The world keeps a
// secondary profile/number index so the same registered phone can be handed
// to another player without changing its IC identity.
const PHONE_PROP_ID = "vcmphone:id";
const PHONE_PROP_IC_NAME = "vcmphone:ic_name";
const PHONE_PROP_NUMBER = "vcmphone:number";
const PHONE_PROFILE_PREFIX = "vcmphone:profile:";
const PHONE_NUMBER_PREFIX = "vcmphone:number_index:";
const PHONE_NAME_MAX_LENGTH = 24;

const MODE_HOLD = "hold";
const MODE_TOGGLE = "toggle";

const PROP_MODE = "vcmumble:mode";
const PROP_LATCH = "vcmumble:toggle_latched";
const PROP_VOICE_RANGE = "vcmumble:voice_range";
const PROP_WELCOME_SHOWN = "vcmumble:sleepy_voice_chat_welcome_shown";
const LEGACY_PROP_MODE = "voicecraft:mode";
const LEGACY_PROP_LATCH = "voicecraft:toggle_latched";
const LEGACY_PROP_VOICE_RANGE = "voicecraft:voice_range";

// Contract implemented by feature/minecraft-mic-addon-v1.
const MIC_ON_TAG = "vcmumble.mic.on";
const MIC_OFF_TAG = "vcmumble.mic.off";
const RANGE_VALUE_PREFIX = "vcmumble.vr.value.";
const RANGE_REQUEST_PREFIX = "vcmumble.vr.request.";
const RANGE_MAX_PREFIX = "vcmumble.vr.max.";
const RANGE_ACK_PREFIX = "vcmumble.vr.ack.";
const RANGE_SYNC_PREFIX = "vcmumble.vr.sync.";
const ATTN_VALUE_PREFIX = "vcmumble.attn.value.";
const ATTN_REQUEST_PREFIX = "vcmumble.attn.request.";
const ATTN_ACK_PREFIX = "vcmumble.attn.ack.";
const ATTN_SYNC_PREFIX = "vcmumble.attn.sync.";

const DEFAULT_VOICE_RANGE = 30;
const DEFAULT_MAX_RANGE = 60;
// Self-only Voice Range preview. Slider movement only updates this local visual;
// it never sends a range request to Endstone. The ring follows the player at
// waist height and expires 10 seconds after the most recent adjustment.
const SAFE_PREVIEW_ENABLED = true;
const SAFE_PREVIEW_PARTICLE = "vcmumble:voice_range_marker";
const SAFE_PREVIEW_POINTS = 24;
const SAFE_PREVIEW_DURATION_TICKS = 20 * 10;
const SAFE_PREVIEW_RENDER_INTERVAL_TICKS = 10;
const SAFE_PREVIEW_POLL_TICKS = 5;
const SAFE_PREVIEW_WAIST_OFFSET = 0.9;
const activeRangePreviews = new Map();
const VOICE_RANGE_SLIDER_SETTLE_TICKS = 15;
const VOICE_RANGE_CHANGE_COOLDOWN_TICKS = 20 * 30;
const RANGE_REQUEST_TIMEOUT_TICKS = 20 * 4;
const RANGE_RETRY_COOLDOWN_TICKS = 20 * 5;
const MIC_MAINTENANCE_INTERVAL_TICKS = 20 * 5;
const RANGE_UI_REFRESH_TICKS = 20;
// One outstanding request per player across form reopen/close.
const globalRangePending = new Map();
const globalRangeResults = new Map();
let rangeRequestSequence = 0;
let attenuationRequestSequence = 0;
const states = new Map();
const rangeChangeCooldownUntil = new Map();

function voiceRangeCooldownTicks(player) {
  return Math.max(
    0,
    (rangeChangeCooldownUntil.get(player.id) ?? 0) - system.currentTick
  );
}

function voiceRangeCooldownSeconds(player) {
  return Math.ceil(voiceRangeCooldownTicks(player) / 20);
}

function startVoiceRangeCooldown(player) {
  rangeChangeCooldownUntil.set(
    player.id,
    system.currentTick + VOICE_RANGE_CHANGE_COOLDOWN_TICKS
  );
}

function setObservableIfChanged(observable, value) {
  try {
    if (observable.getData() === value) return;
  } catch {}
  try {
    observable.setData(value);
  } catch {}
}

function isMicId(typeId) {
  return (
    typeId === MIC_OFF ||
    typeId === MIC_ON ||
    typeId === LEGACY_HOLD ||
    typeId === LEGACY_TOGGLE
  );
}

function isLegacyId(typeId) {
  return typeId === LEGACY_HOLD || typeId === LEGACY_TOGGLE;
}

function inventory(player) {
  return player.getComponent(EntityComponentTypes.Inventory)?.container;
}

function equippable(player) {
  return player.getComponent(EntityComponentTypes.Equippable);
}

function itemId(stack) {
  return stack?.typeId ?? "";
}

function getMainId(player) {
  try {
    return itemId(equippable(player)?.getEquipment(EquipmentSlot.Mainhand));
  } catch {
    return "";
  }
}

function getOffId(player) {
  try {
    return itemId(equippable(player)?.getEquipment(EquipmentSlot.Offhand));
  } catch {
    return "";
  }
}

function migrateDynamicProperties(player) {
  try {
    if (player.getDynamicProperty(PROP_MODE) === undefined) {
      const oldMode = player.getDynamicProperty(LEGACY_PROP_MODE);
      if (oldMode === MODE_TOGGLE || oldMode === MODE_HOLD) {
        player.setDynamicProperty(PROP_MODE, oldMode);
      }
    }
    if (player.getDynamicProperty(PROP_LATCH) === undefined) {
      const oldLatch = player.getDynamicProperty(LEGACY_PROP_LATCH);
      if (oldLatch === true || oldLatch === false) {
        player.setDynamicProperty(PROP_LATCH, oldLatch);
      }
    }
    if (player.getDynamicProperty(PROP_VOICE_RANGE) === undefined) {
      const oldRange = Number(player.getDynamicProperty(LEGACY_PROP_VOICE_RANGE));
      if (Number.isFinite(oldRange) && oldRange >= 1) {
        player.setDynamicProperty(PROP_VOICE_RANGE, Math.floor(oldRange));
      }
    }
  } catch {}
}

function getMode(player) {
  const value = player.getDynamicProperty(PROP_MODE);
  if (value === MODE_TOGGLE) return MODE_TOGGLE;
  if (value === MODE_HOLD) return MODE_HOLD;

  const legacy = player.getDynamicProperty(LEGACY_PROP_MODE);
  if (legacy === MODE_TOGGLE || legacy === MODE_HOLD) {
    player.setDynamicProperty(PROP_MODE, legacy);
    return legacy;
  }

  // New players default to Toggle. Existing Hold/Toggle preferences are preserved.
  player.setDynamicProperty(PROP_MODE, MODE_TOGGLE);
  return MODE_TOGGLE;
}

function setMode(player, mode) {
  player.setDynamicProperty(PROP_MODE, mode === MODE_TOGGLE ? MODE_TOGGLE : MODE_HOLD);
}

function getLatch(player) {
  const value = player.getDynamicProperty(PROP_LATCH);
  if (value === true) return true;
  if (value === false) return false;
  return player.getDynamicProperty(LEGACY_PROP_LATCH) === true;
}

function setLatch(player, value) {
  player.setDynamicProperty(PROP_LATCH, !!value);
}

function makeMic(on) {
  const stack = new ItemStack(on ? MIC_ON : MIC_OFF, 1);
  stack.lockMode = ItemLockMode.inventory;
  stack.keepOnDeath = true;
  return stack;
}

function scanMic(player) {
  const result = [];
  const inv = inventory(player);
  if (inv) {
    for (let i = 0; i < inv.size; i++) {
      const id = itemId(inv.getItem(i));
      if (isMicId(id)) result.push({ where: "inventory", index: i, id });
    }
  }
  try {
    const offId = getOffId(player);
    if (isMicId(offId)) result.push({ where: "offhand", index: -1, id: offId });
  } catch {}
  return result;
}

function enforceSingleMic(player) {
  const inv = inventory(player);
  const offMic = isMicId(getOffId(player));
  let keepIndex = -1;

  if (!offMic && inv) {
    let selected = -1;
    try {
      selected = Number(player.selectedSlotIndex);
    } catch {}

    if (
      Number.isInteger(selected) &&
      selected >= 0 &&
      selected < inv.size &&
      isMicId(itemId(inv.getItem(selected)))
    ) {
      keepIndex = selected;
    }

    if (keepIndex < 0) {
      for (let i = 0; i < inv.size; i++) {
        if (isMicId(itemId(inv.getItem(i)))) {
          keepIndex = i;
          break;
        }
      }
    }
  }

  let removed = 0;
  if (inv) {
    for (let i = 0; i < inv.size; i++) {
      if (!isMicId(itemId(inv.getItem(i)))) continue;
      if (!offMic && i === keepIndex) continue;
      inv.setItem(i, undefined);
      removed++;
    }
  }

  if (removed > 0) {
    console.warn(
      `[VCMumbleItem/BP] MIC_DUPLICATE_REMOVED player=${player.name} removed=${removed}`
    );
  }
}

function hasAnyMic(player) {
  return scanMic(player).length > 0;
}

function ensureMic(player) {
  enforceSingleMic(player);
  if (hasAnyMic(player)) return;

  const inv = inventory(player);
  if (!inv) return;

  const leftover = inv.addItem(makeMic(false));
  if (leftover) {
    player.sendMessage("§c[VC Mumble] Inventory เต็ม — ไม่สามารถมอบ Mic ได้§r");
    return;
  }

  console.warn(`[VCMumbleItem/BP] MIC_GIVEN player=${player.name} state=OFF`);
}

function migrateLegacyItems(player) {
  let legacyMode = null;
  const inv = inventory(player);

  if (inv) {
    for (let i = 0; i < inv.size; i++) {
      const current = inv.getItem(i);
      const id = itemId(current);
      if (!isLegacyId(id)) continue;

      if (id === LEGACY_TOGGLE) legacyMode = MODE_TOGGLE;
      else if (legacyMode === null) legacyMode = MODE_HOLD;

      inv.setItem(i, makeMic(false));
      console.warn(`[VCMumbleItem/BP] MIGRATE player=${player.name} slot=${i} ${id}->${MIC_OFF}`);
    }
  }

  try {
    const eq = equippable(player);
    const off = eq?.getEquipment(EquipmentSlot.Offhand);
    const id = itemId(off);
    if (isLegacyId(id)) {
      legacyMode = id === LEGACY_TOGGLE ? MODE_TOGGLE : MODE_HOLD;
      eq?.setEquipment(EquipmentSlot.Offhand, makeMic(false));
    }
  } catch {}

  if (legacyMode !== null) {
    setMode(player, legacyMode);
    setLatch(player, false);
    states.delete(player.id);
  }
}

function replaceMicStatus(player, on) {
  const target = on ? MIC_ON : MIC_OFF;
  let changed = false;
  const inv = inventory(player);

  if (inv) {
    for (let i = 0; i < inv.size; i++) {
      const current = inv.getItem(i);
      const id = itemId(current);
      if (!isMicId(id) || id === target) continue;
      inv.setItem(i, makeMic(on));
      changed = true;
    }
  }

  try {
    const eq = equippable(player);
    const off = eq?.getEquipment(EquipmentSlot.Offhand);
    const id = itemId(off);
    if (isMicId(id) && id !== target) {
      eq?.setEquipment(EquipmentSlot.Offhand, makeMic(on));
      changed = true;
    }
  } catch (e) {
    console.warn(`[VCMumbleItem/BP] offhand status replace failed player=${player.name}: ${e}`);
  }

  return changed;
}

function reassertMicFlags(player) {
  const inv = inventory(player);
  if (inv) {
    for (let i = 0; i < inv.size; i++) {
      try {
        const slot = inv.getSlot(i);
        if (!slot || !slot.hasItem() || !isMicId(slot.typeId)) continue;
        slot.lockMode = ItemLockMode.inventory;
        slot.keepOnDeath = true;
      } catch {}
    }
  }

  try {
    const off = equippable(player)?.getEquipmentSlot(EquipmentSlot.Offhand);
    if (off && isMicId(off.typeId)) {
      off.lockMode = ItemLockMode.inventory;
      off.keepOnDeath = true;
    }
  } catch {}
}

function publishMicState(player, on) {
  const wanted = on ? MIC_ON_TAG : MIC_OFF_TAG;
  const unwanted = on ? MIC_OFF_TAG : MIC_ON_TAG;

  try {
    // Keep the two bridge tags strictly mutually exclusive. Some worlds can
    // retain an old OFF tag while the visual Mic item has already switched ON.
    // OFF takes priority. Never leave an untagged/ambiguous ON transition.
    if (on) {
      try { if (player.hasTag(MIC_OFF_TAG)) player.removeTag(MIC_OFF_TAG); } catch {}
      try { if (!player.hasTag(MIC_ON_TAG)) player.addTag(MIC_ON_TAG); } catch {}
    } else {
      try { if (!player.hasTag(MIC_OFF_TAG)) player.addTag(MIC_OFF_TAG); } catch {}
      try { if (player.hasTag(MIC_ON_TAG)) player.removeTag(MIC_ON_TAG); } catch {}
    }

    let tags = [];
    try {
      tags = player.getTags();
    } catch {}
    const correct = tags.includes(wanted) && !tags.includes(unwanted);

    // Command fallback repairs tag state if Script API tag mutation did not
    // become visible immediately to Endstone. Only runs when verification fails.
    if (!correct) {
      console.warn(`[VCMumbleItem/BP] MIC_TAG_RETRY player=${player.name} wanted=${on ? "ON" : "OFF"}`);
    }
    return correct;
  } catch (e) {
    console.warn(`[VCMumbleItem/BP] mic tag sync failed player=${player.name}: ${e}`);
    return false;
  }
}
function stateFor(player) {
  let state = states.get(player.id);
  if (state) return state;

  const mode = getMode(player);
  const mainMic = isMicId(getMainId(player));
  const offMic = isMicId(getOffId(player));
  let latch = getLatch(player);

  if (mode === MODE_TOGGLE && player.getDynamicProperty(PROP_LATCH) === undefined) {
    const anyOn = scanMic(player).some((entry) => entry.id === MIC_ON);
    if (anyOn && !offMic) latch = true;
  }

  const effective = mode === MODE_HOLD ? (mainMic || offMic) : latch;
  state = {
    mode,
    lastMainMic: mainMic,
    toggleLatched: latch,
    effective,
    micKnown: mainMic || offMic || hasAnyMic(player),
    statusApplied: false,
    lastPublishedTick: -MIC_MAINTENANCE_INTERVAL_TICKS,
  };
  states.set(player.id, state);
  return state;
}

function evaluate(player) {
  // Tick-hot path: equipment reads only. Full inventory scanning/give/repair is
  // delegated to five-second maintenance and explicit spawn / UI opening.
  const state = stateFor(player);
  const mainMic = isMicId(getMainId(player));
  const offMic = isMicId(getOffId(player));
  const hasMic = state.micKnown || mainMic || offMic;
  const mode = getMode(player);

  if (mode !== state.mode) {
    if (mode === MODE_TOGGLE) {
      state.toggleLatched = !!(mainMic || offMic);
      setLatch(player, state.toggleLatched);
    } else {
      state.toggleLatched = false;
      setLatch(player, false);
    }
    state.mode = mode;
  }

  if (hasMic && mode === MODE_TOGGLE && mainMic && !state.lastMainMic && !offMic) {
    state.toggleLatched = !state.toggleLatched;
    setLatch(player, state.toggleLatched);
    console.warn(
      `[VCMumbleItem/BP] TOGGLE_EDGE player=${player.name} latched=${state.toggleLatched}`
    );
  }

  if (!hasMic) {
    state.toggleLatched = false;
    setLatch(player, false);
  }

  const effective =
    hasMic && (mode === MODE_HOLD ? (mainMic || offMic) : state.toggleLatched);

  if (effective !== state.effective) {
    state.effective = effective;
    console.warn(
      `[VCMumbleItem/BP] MIC_LOCAL player=${player.name} mic=${effective ? "ON" : "OFF"} mode=${mode}`
    );
  }

  // An externally changed item must never visually say OFF while the state is ON.
  const wantedItem = effective ? MIC_ON : MIC_OFF;
  const selectedId = getMainId(player);
  const offhandId = getOffId(player);
  if (!state.statusApplied || effective !== state.appliedEffective ||
      (isMicId(selectedId) && selectedId !== wantedItem) ||
      (isMicId(offhandId) && offhandId !== wantedItem)) {
    replaceMicStatus(player, effective);
    state.appliedEffective = effective;
    state.statusApplied = true;
  }
  if (effective !== state.publishedEffective ||
      system.currentTick - state.lastPublishedTick >= MIC_MAINTENANCE_INTERVAL_TICKS) {
    if (publishMicState(player, effective)) {
      state.publishedEffective = effective;
      state.lastPublishedTick = system.currentTick;
    }
  }
  state.lastMainMic = mainMic;
}

function isPhoneId(typeId) {
  return typeId === PHONE;
}

const PHONE_CONTACTS_PREFIX = "vcmphone:contacts:";
const PHONE_INBOX_PREFIX = "vcmphone:inbox:";
const PHONE_CONTACT_LIMIT = 30;
const PHONE_INBOX_LIMIT = 30;
const PHONE_MESSAGE_MAX_LENGTH = 500;
const PHONE_CONTACT_NAME_MAX_LENGTH = 24;
const PHONE_CONVERSATION_INDEX_PREFIX = "vcmphone:conversation_index:";
const PHONE_CONVERSATION_META_PREFIX = "vcmphone:conversation_meta:";
const PHONE_CONVERSATION_PAGE_PREFIX = "vcmphone:conversation_page:";
const PHONE_CONVERSATION_PAGE_SIZE = 25;
const PHONE_CONVERSATION_MAX_MESSAGES = 250;
const PHONE_CONVERSATION_LIST_LIMIT = 30;
const PHONE_CHAT_PAGE_SIZE = 20;
const PHONE_NOTIFICATION_SOUND = "voicecraft.phone.notification";
const PHONE_RING_SOUND = "voicecraft.phone.ring";
const PHONE_RING_INTERVAL_TICKS = 40;
const phoneCallLastRingTick = new Map();
const PHONE_CALL_PREFIX = "vcmphone:call:";
const PHONE_ACTIVE_CALL_PREFIX = "vcmphone:active_call:";
const PHONE_CALL_INDEX_PROP = "vcmphone:call_index";
const PHONE_CALL_RING_MS = 60 * 1000;
const PHONE_CALL_TAG_PREFIX = "vcmumble.call.active.";
const PHONE_SPEAKER_RADIUS = 4;
const ANONYMOUS_NUMBER = "#@+*";
const ANONYMOUS_NAME = "ไม่ระบุตัวตน";

function currentPhoneSlot(player) {
  try {
    const eq = equippable(player);
    const main = eq?.getEquipmentSlot(EquipmentSlot.Mainhand);
    if (main && isPhoneId(main.typeId)) return main;
  } catch {}

  try {
    const eq = equippable(player);
    const off = eq?.getEquipmentSlot(EquipmentSlot.Offhand);
    if (off && isPhoneId(off.typeId)) return off;
  } catch {}

  const inv = inventory(player);
  if (!inv) return undefined;

  try {
    const selected = Number(player.selectedSlotIndex);
    if (Number.isInteger(selected) && selected >= 0 && selected < inv.size) {
      const slot = inv.getSlot(selected);
      if (slot && isPhoneId(slot.typeId)) return slot;
    }
  } catch {}

  for (let i = 0; i < inv.size; i++) {
    try {
      const slot = inv.getSlot(i);
      if (slot && isPhoneId(slot.typeId)) return slot;
    } catch {}
  }
  return undefined;
}

function phoneItemData(slot) {
  if (!slot || !isPhoneId(slot.typeId)) return undefined;
  try {
    const id = String(slot.getDynamicProperty(PHONE_PROP_ID) ?? "").trim();
    const icName = String(slot.getDynamicProperty(PHONE_PROP_IC_NAME) ?? "").trim();
    const number = String(slot.getDynamicProperty(PHONE_PROP_NUMBER) ?? "").trim();
    if (!id || !icName || !/^\d{4}$/.test(number)) return undefined;
    return { id, icName, number };
  } catch {
    return undefined;
  }
}

function readPhoneProfile(phoneId) {
  if (!phoneId) return undefined;
  try {
    const raw = world.getDynamicProperty(PHONE_PROFILE_PREFIX + phoneId);
    if (typeof raw !== "string" || !raw) return undefined;
    const data = JSON.parse(raw);
    const id = String(data?.id ?? "").trim();
    const icName = String(data?.icName ?? "").trim();
    const number = String(data?.number ?? "").trim();
    if (!id || id !== phoneId || !icName || !/^\d{4}$/.test(number)) return undefined;
    return { id, icName, number };
  } catch {
    return undefined;
  }
}

function writePhoneProfile(profile) {
  const payload = JSON.stringify({
    id: profile.id,
    icName: profile.icName,
    number: profile.number,
  });
  world.setDynamicProperty(PHONE_PROFILE_PREFIX + profile.id, payload);
  world.setDynamicProperty(PHONE_NUMBER_PREFIX + profile.number, profile.id);
}

function phoneNumberOwner(number) {
  try {
    const value = world.getDynamicProperty(PHONE_NUMBER_PREFIX + number);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function readPhoneProfileByNumber(number) {
  const clean = String(number ?? "").trim();
  if (!/^\d{4}$/.test(clean)) return undefined;
  const phoneId = phoneNumberOwner(clean);
  return phoneId ? readPhoneProfile(phoneId) : undefined;
}

function normalizeIcName(raw) {
  const value = String(raw ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value || value.length > PHONE_NAME_MAX_LENGTH || value.includes("§")) {
    return "";
  }
  return value;
}

function normalizeContactName(raw) {
  const value = String(raw ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return "";
  if (value.length > PHONE_CONTACT_NAME_MAX_LENGTH || value.includes("§")) return undefined;
  return value;
}

function normalizeMessage(raw) {
  const value = String(raw ?? "").replace(/\r/g, "").trim();
  if (!value || value.length > PHONE_MESSAGE_MAX_LENGTH || value.includes("§")) return "";
  return value;
}

function createPhoneId(player) {
  const ownerPart = String(player?.id ?? "player")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-8) || "player";
  for (let attempt = 0; attempt < 20; attempt++) {
    const randomPart = Math.floor(Math.random() * 0x7fffffff).toString(36);
    const id = `p${system.currentTick.toString(36)}_${ownerPart}_${randomPart}`;
    if (!readPhoneProfile(id)) return id;
  }
  return `p${system.currentTick.toString(36)}_${ownerPart}_${Date.now().toString(36)}`;
}

function randomAvailablePhoneNumber() {
  const start = Math.floor(Math.random() * 10000);
  for (let offset = 0; offset < 10000; offset++) {
    const number = String((start + offset) % 10000).padStart(4, "0");
    if (!phoneNumberOwner(number)) return number;
  }
  return "";
}

function setPhoneItemIdentity(slot, profile) {
  slot.setDynamicProperty(PHONE_PROP_ID, profile.id);
  slot.setDynamicProperty(PHONE_PROP_IC_NAME, profile.icName);
  slot.setDynamicProperty(PHONE_PROP_NUMBER, profile.number);
  slot.setLore([
    "",
    `§7ชื่อ IC: §f${profile.icName}§r`,
    "",
    `§7เบอร์: §b${profile.number}§r`,
  ]);
}

function resolvePhoneProfile(player) {
  const slot = currentPhoneSlot(player);
  const itemData = phoneItemData(slot);
  if (!itemData) return { slot, profile: undefined };

  const stored = readPhoneProfile(itemData.id);
  if (stored) {
    if (stored.icName !== itemData.icName || stored.number !== itemData.number) {
      try { setPhoneItemIdentity(slot, stored); } catch {}
    }
    return { slot, profile: stored };
  }

  const owner = phoneNumberOwner(itemData.number);
  if (!owner || owner === itemData.id) {
    try {
      writePhoneProfile(itemData);
      return { slot, profile: itemData };
    } catch {}
  }
  return { slot, profile: itemData };
}

function readPhoneContacts(phoneId) {
  try {
    const raw = world.getDynamicProperty(PHONE_CONTACTS_PREFIX + phoneId);
    if (typeof raw !== "string" || !raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .map((entry) => ({
        phoneId: String(entry?.phoneId ?? "").trim(),
        name: String(entry?.name ?? "").trim(),
        number: String(entry?.number ?? "").trim(),
        createdAt: Number(entry?.createdAt ?? 0),
        favorite: entry?.favorite === true,
      }))
      .filter((entry) => entry.phoneId && entry.name && /^\d{4}$/.test(entry.number))
      .slice(0, PHONE_CONTACT_LIMIT);
  } catch {
    return [];
  }
}

function writePhoneContacts(phoneId, contacts) {
  const clean = Array.isArray(contacts) ? contacts.slice(0, PHONE_CONTACT_LIMIT) : [];
  world.setDynamicProperty(PHONE_CONTACTS_PREFIX + phoneId, JSON.stringify(clean));
}

function readPhoneInbox(phoneId) {
  try {
    const raw = world.getDynamicProperty(PHONE_INBOX_PREFIX + phoneId);
    if (typeof raw !== "string" || !raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .map((entry) => ({
        id: String(entry?.id ?? "").trim(),
        senderPhoneId: String(entry?.senderPhoneId ?? "").trim(),
        senderName: String(entry?.senderName ?? "").trim(),
        senderNumber: String(entry?.senderNumber ?? "").trim(),
        anonymous: entry?.anonymous === true,
        body: String(entry?.body ?? ""),
        timestamp: Number(entry?.timestamp ?? 0),
        read: entry?.read === true,
      }))
      .filter((entry) => entry.id && entry.senderName && entry.senderNumber && entry.body)
      .slice(0, PHONE_INBOX_LIMIT);
  } catch {
    return [];
  }
}

function writePhoneInbox(phoneId, inbox) {
  const clean = Array.isArray(inbox) ? inbox.slice(0, PHONE_INBOX_LIMIT) : [];
  world.setDynamicProperty(PHONE_INBOX_PREFIX + phoneId, JSON.stringify(clean));
}

function playPhoneSound(player, soundId, volume = 1) {
  if (!player || !soundId) return;
  try {
    player.playSound(soundId, { volume, pitch: 1 });
    return;
  } catch {}
  try {
    player.runCommand(`playsound ${soundId} @s ~ ~ ~ ${volume} 1`);
  } catch {}
}

function conversationHash(value) {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function conversationIdForPhones(phoneA, phoneB) {
  const pair = [String(phoneA ?? ""), String(phoneB ?? "")].sort();
  const seed = `${pair[0]}|${pair[1]}`;
  return `cv_${conversationHash(seed)}_${conversationHash(seed + "#2")}`;
}

function readConversationIndex(phoneId) {
  try {
    const raw = world.getDynamicProperty(PHONE_CONVERSATION_INDEX_PREFIX + phoneId);
    if (typeof raw !== "string" || !raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return [...new Set(data.map((id) => String(id ?? "").trim()).filter(Boolean))]
      .slice(0, PHONE_CONVERSATION_LIST_LIMIT);
  } catch {
    return [];
  }
}

function writeConversationIndex(phoneId, ids) {
  const clean = [...new Set((Array.isArray(ids) ? ids : [])
    .map((id) => String(id ?? "").trim())
    .filter(Boolean))].slice(0, PHONE_CONVERSATION_LIST_LIMIT);
  try {
    world.setDynamicProperty(
      PHONE_CONVERSATION_INDEX_PREFIX + phoneId,
      clean.length ? JSON.stringify(clean) : undefined
    );
  } catch {}
}

function touchConversationIndex(phoneId, conversationId) {
  const ids = readConversationIndex(phoneId).filter((id) => id !== conversationId);
  ids.unshift(conversationId);
  writeConversationIndex(phoneId, ids);
}

function readConversationMeta(conversationId) {
  try {
    const raw = world.getDynamicProperty(PHONE_CONVERSATION_META_PREFIX + conversationId);
    if (typeof raw !== "string" || !raw) return undefined;
    const data = JSON.parse(raw);
    const meta = {
      id: String(data?.id ?? "").trim(),
      phoneA: String(data?.phoneA ?? "").trim(),
      phoneB: String(data?.phoneB ?? "").trim(),
      firstPage: Math.max(0, Number(data?.firstPage ?? 0) || 0),
      lastPage: Math.max(0, Number(data?.lastPage ?? 0) || 0),
      count: Math.max(0, Number(data?.count ?? 0) || 0),
      lastMessageAt: Number(data?.lastMessageAt ?? 0) || 0,
      lastMessageId: String(data?.lastMessageId ?? ""),
      lastSenderPhoneId: String(data?.lastSenderPhoneId ?? ""),
      lastPreview: String(data?.lastPreview ?? ""),
      unreadA: Math.max(0, Number(data?.unreadA ?? 0) || 0),
      unreadB: Math.max(0, Number(data?.unreadB ?? 0) || 0),
      lastReadAtA: Math.max(0, Number(data?.lastReadAtA ?? 0) || 0),
      lastReadAtB: Math.max(0, Number(data?.lastReadAtB ?? 0) || 0),
    };
    if (!meta.id || meta.id !== conversationId || !meta.phoneA || !meta.phoneB) return undefined;
    return meta;
  } catch {
    return undefined;
  }
}

function writeConversationMeta(meta) {
  if (!meta?.id) return;
  world.setDynamicProperty(PHONE_CONVERSATION_META_PREFIX + meta.id, JSON.stringify(meta));
}

function conversationPageKey(conversationId, page) {
  return `${PHONE_CONVERSATION_PAGE_PREFIX}${conversationId}:${page}`;
}

function readConversationPage(conversationId, page) {
  try {
    const raw = world.getDynamicProperty(conversationPageKey(conversationId, page));
    if (typeof raw !== "string" || !raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.map((entry) => ({
      id: String(entry?.id ?? "").trim(),
      senderPhoneId: String(entry?.senderPhoneId ?? "").trim(),
      body: String(entry?.body ?? ""),
      timestamp: Number(entry?.timestamp ?? 0) || 0,
    })).filter((entry) => entry.id && entry.senderPhoneId && entry.body && entry.timestamp > 0);
  } catch {
    return [];
  }
}

function writeConversationPage(conversationId, page, messages) {
  try {
    const clean = Array.isArray(messages) ? messages.slice(0, PHONE_CONVERSATION_PAGE_SIZE) : [];
    world.setDynamicProperty(
      conversationPageKey(conversationId, page),
      clean.length ? JSON.stringify(clean) : undefined
    );
  } catch {}
}

function conversationSide(meta, phoneId) {
  if (meta?.phoneA === phoneId) return "A";
  if (meta?.phoneB === phoneId) return "B";
  return "";
}

function otherConversationPhoneId(meta, ownerPhoneId) {
  if (meta?.phoneA === ownerPhoneId) return meta.phoneB;
  if (meta?.phoneB === ownerPhoneId) return meta.phoneA;
  return "";
}

function ensureConversation(phoneA, phoneB) {
  const a = String(phoneA ?? "").trim();
  const b = String(phoneB ?? "").trim();
  if (!a || !b || a === b) return undefined;
  const id = conversationIdForPhones(a, b);
  let meta = readConversationMeta(id);
  if (meta) return meta;
  const pair = [a, b].sort();
  meta = {
    id,
    phoneA: pair[0],
    phoneB: pair[1],
    firstPage: 0,
    lastPage: 0,
    count: 0,
    lastMessageAt: 0,
    lastMessageId: "",
    lastSenderPhoneId: "",
    lastPreview: "",
    unreadA: 0,
    unreadB: 0,
    lastReadAtA: 0,
    lastReadAtB: 0,
  };
  writeConversationMeta(meta);
  touchConversationIndex(meta.phoneA, id);
  touchConversationIndex(meta.phoneB, id);
  return meta;
}

function appendConversationRecord(senderPhoneId, recipientPhoneId, record, recipientAlreadyRead = false) {
  let meta = ensureConversation(senderPhoneId, recipientPhoneId);
  if (!meta) return undefined;

  let page = readConversationPage(meta.id, meta.lastPage);
  if (page.length >= PHONE_CONVERSATION_PAGE_SIZE) {
    meta.lastPage += 1;
    page = [];
  }

  const message = {
    id: String(record?.id ?? createMessageId()),
    senderPhoneId: String(senderPhoneId),
    body: String(record?.body ?? ""),
    timestamp: Number(record?.timestamp ?? Date.now()),
  };
  page.push(message);
  writeConversationPage(meta.id, meta.lastPage, page);

  meta.count += 1;
  meta.lastMessageAt = message.timestamp;
  meta.lastMessageId = message.id;
  meta.lastSenderPhoneId = message.senderPhoneId;
  meta.lastPreview = message.body.replace(/[\r\n]+/g, " ").slice(0, 48);
  const recipientSide = conversationSide(meta, recipientPhoneId);
  if (recipientSide === "A") {
    if (recipientAlreadyRead) meta.lastReadAtA = Math.max(meta.lastReadAtA, message.timestamp);
    else meta.unreadA += 1;
  } else if (recipientSide === "B") {
    if (recipientAlreadyRead) meta.lastReadAtB = Math.max(meta.lastReadAtB, message.timestamp);
    else meta.unreadB += 1;
  }

  while (meta.count > PHONE_CONVERSATION_MAX_MESSAGES) {
    const oldest = readConversationPage(meta.id, meta.firstPage);
    if (!oldest.length) {
      meta.firstPage += 1;
      if (meta.firstPage > meta.lastPage) break;
      continue;
    }
    oldest.shift();
    meta.count -= 1;
    if (oldest.length) writeConversationPage(meta.id, meta.firstPage, oldest);
    else {
      writeConversationPage(meta.id, meta.firstPage, []);
      meta.firstPage += 1;
    }
  }

  writeConversationMeta(meta);
  touchConversationIndex(meta.phoneA, meta.id);
  touchConversationIndex(meta.phoneB, meta.id);
  return { meta, message };
}

function appendConversationMessage(senderProfile, recipientProfile, body) {
  return appendConversationRecord(
    senderProfile.id,
    recipientProfile.id,
    { id: createMessageId(), body, timestamp: Date.now() },
    false
  );
}

function readConversationWindow(conversationId, pageOffset = 0) {
  const meta = readConversationMeta(conversationId);
  if (!meta || meta.count <= 0) return { meta, messages: [], hasOlder: false, hasNewer: pageOffset > 0 };
  const offset = Math.max(0, Math.floor(pageOffset));
  const needed = (offset + 1) * PHONE_CHAT_PAGE_SIZE;
  let collected = [];
  for (let pageNo = meta.lastPage; pageNo >= meta.firstPage; pageNo--) {
    const page = readConversationPage(conversationId, pageNo);
    if (page.length) collected = page.concat(collected);
    if (collected.length >= needed) break;
  }
  const end = Math.max(0, collected.length - offset * PHONE_CHAT_PAGE_SIZE);
  const start = Math.max(0, end - PHONE_CHAT_PAGE_SIZE);
  return {
    meta,
    messages: collected.slice(start, end),
    hasOlder: meta.count > (offset + 1) * PHONE_CHAT_PAGE_SIZE,
    hasNewer: offset > 0,
  };
}

function markConversationRead(conversationId, phoneId) {
  const meta = readConversationMeta(conversationId);
  if (!meta) return undefined;
  const now = Date.now();
  const side = conversationSide(meta, phoneId);
  let changed = false;
  if (side === "A" && meta.unreadA > 0) {
    meta.unreadA = 0;
    meta.lastReadAtA = Math.max(meta.lastReadAtA, now);
    changed = true;
  } else if (side === "B" && meta.unreadB > 0) {
    meta.unreadB = 0;
    meta.lastReadAtB = Math.max(meta.lastReadAtB, now);
    changed = true;
  }
  if (changed) writeConversationMeta(meta);
  return meta;
}

function conversationUnreadForPhone(meta, phoneId) {
  const side = conversationSide(meta, phoneId);
  return side === "A" ? meta.unreadA : side === "B" ? meta.unreadB : 0;
}

function conversationOtherReadAt(meta, ownerPhoneId) {
  const otherId = otherConversationPhoneId(meta, ownerPhoneId);
  const side = conversationSide(meta, otherId);
  return side === "A" ? meta.lastReadAtA : side === "B" ? meta.lastReadAtB : 0;
}

function conversationDisplay(ownerPhoneId, meta) {
  const otherPhoneId = otherConversationPhoneId(meta, ownerPhoneId);
  const profile = readPhoneProfile(otherPhoneId);
  const name = resolvePhoneAlias(ownerPhoneId, otherPhoneId);
  return { otherPhoneId, name, number: profile?.number || "----" };
}

function readPhoneConversations(phoneId) {
  const metas = [];
  for (const id of readConversationIndex(phoneId)) {
    const meta = readConversationMeta(id);
    if (!meta || !conversationSide(meta, phoneId)) continue;
    metas.push(meta);
  }
  metas.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  return metas.slice(0, PHONE_CONVERSATION_LIST_LIMIT);
}

function migrateLegacyInboxToConversations(phoneId) {
  const inbox = readPhoneInbox(phoneId);
  const normal = inbox.filter((message) => message.anonymous !== true && message.senderPhoneId);
  if (!normal.length) return;
  const keep = inbox.filter((message) => message.anonymous === true || !message.senderPhoneId);
  let allMigrated = true;
  for (const message of [...normal].reverse()) {
    const sender = readPhoneProfile(message.senderPhoneId);
    const recipient = readPhoneProfile(phoneId);
    if (!sender || !recipient) {
      keep.push(message);
      allMigrated = false;
      continue;
    }
    try {
      appendConversationRecord(
        sender.id,
        recipient.id,
        { id: message.id, body: message.body, timestamp: message.timestamp },
        message.read === true
      );
    } catch {
      keep.push(message);
      allMigrated = false;
    }
  }
  if (allMigrated || keep.length !== inbox.length) {
    keep.sort((a, b) => b.timestamp - a.timestamp);
    writePhoneInbox(phoneId, keep);
  }
}

function createMessageId() {
  return `m${Date.now().toString(36)}_${system.currentTick.toString(36)}_${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

function formatPhoneMessageTime(timestamp) {
  const safe = Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
  const utc7 = new Date(safe + 7 * 60 * 60 * 1000);
  const day = String(utc7.getUTCDate()).padStart(2, "0");
  const month = String(utc7.getUTCMonth() + 1).padStart(2, "0");
  const year = utc7.getUTCFullYear();
  const hour = String(utc7.getUTCHours()).padStart(2, "0");
  const minute = String(utc7.getUTCMinutes()).padStart(2, "0");
  return { date: `${day}/${month}/${year}`, time: `${hour}:${minute}` };
}

function slotHasPhoneId(slot, phoneId) {
  if (!slot || !isPhoneId(slot.typeId)) return false;
  try {
    return String(slot.getDynamicProperty(PHONE_PROP_ID) ?? "") === phoneId;
  } catch {
    return false;
  }
}

function playerHasPhoneId(player, phoneId) {
  try {
    const eq = equippable(player);
    if (slotHasPhoneId(eq?.getEquipmentSlot(EquipmentSlot.Mainhand), phoneId)) return true;
    if (slotHasPhoneId(eq?.getEquipmentSlot(EquipmentSlot.Offhand), phoneId)) return true;
  } catch {}

  const inv = inventory(player);
  if (!inv) return false;
  for (let i = 0; i < inv.size; i++) {
    try {
      if (slotHasPhoneId(inv.getSlot(i), phoneId)) return true;
    } catch {}
  }
  return false;
}

function resolveIncomingMessageName(recipientPhoneId, message) {
  if (message?.anonymous === true) return ANONYMOUS_NAME;

  try {
    const contacts = readPhoneContacts(recipientPhoneId);
    const saved = contacts.find(
      (entry) =>
        (message?.senderPhoneId && entry.phoneId === message.senderPhoneId) ||
        (message?.senderNumber && entry.number === message.senderNumber)
    );
    if (saved?.name) return saved.name;
  } catch {}

  // Unknown numbers remain number-only until this phone saves them as a contact.
  return "";
}

function notifyPhoneRecipient(phoneId, message) {
  const senderName = resolveIncomingMessageName(phoneId, message);
  const senderNumber = message?.anonymous === true
    ? ANONYMOUS_NUMBER
    : String(message?.senderNumber ?? "");
  const text = message?.anonymous === true
    ? `§b[ SleepyPhone ]§r มีข้อความจาก ${ANONYMOUS_NAME} ${ANONYMOUS_NUMBER}`
    : senderName
      ? `§b[ SleepyPhone ]§r มีข้อความจาก ${senderName} ${senderNumber}`
      : `§b[ SleepyPhone ]§r มีข้อความจากเบอร์ ${senderNumber}`;

  for (const target of world.getAllPlayers()) {
    if (!playerHasPhoneId(target, phoneId)) continue;
    try { target.sendMessage(text); } catch {}
    playPhoneSound(target, PHONE_NOTIFICATION_SOUND, 0.9);
  }
}

function createPhoneCallId() {
  return `c${Date.now().toString(36)}_${system.currentTick.toString(36)}_${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

function readPhoneCallIndex() {
  try {
    const raw = world.getDynamicProperty(PHONE_CALL_INDEX_PROP);
    if (typeof raw !== "string" || !raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((value) => String(value ?? "").trim()).filter(Boolean))].slice(0, 128);
  } catch {
    return [];
  }
}

function writePhoneCallIndex(ids) {
  try {
    const clean = [...new Set((Array.isArray(ids) ? ids : []).map((value) => String(value ?? "").trim()).filter(Boolean))].slice(0, 128);
    world.setDynamicProperty(PHONE_CALL_INDEX_PROP, clean.length ? JSON.stringify(clean) : undefined);
  } catch {}
}

function readPhoneCall(callId) {
  const id = String(callId ?? "").trim();
  if (!id) return undefined;
  try {
    const raw = world.getDynamicProperty(PHONE_CALL_PREFIX + id);
    if (typeof raw !== "string" || !raw) return undefined;
    const data = JSON.parse(raw);
    const call = {
      id: String(data?.id ?? "").trim(),
      callerPhoneId: String(data?.callerPhoneId ?? "").trim(),
      calleePhoneId: String(data?.calleePhoneId ?? "").trim(),
      anonymous: data?.anonymous === true,
      status: String(data?.status ?? "").trim(),
      createdAt: Number(data?.createdAt ?? 0),
      expiresAt: Number(data?.expiresAt ?? 0),
      acceptedAt: Number(data?.acceptedAt ?? 0),
      callerSpeaker: data?.callerSpeaker === true,
      calleeSpeaker: data?.calleeSpeaker === true,
      callerPlayerId: String(data?.callerPlayerId ?? "").trim(),
      calleePlayerId: String(data?.calleePlayerId ?? "").trim(),
    };
    if (!call.id || call.id !== id || !call.callerPhoneId || !call.calleePhoneId) return undefined;
    if (call.status !== "ringing" && call.status !== "active") return undefined;
    return call;
  } catch {
    return undefined;
  }
}

function activeCallIdForPhone(phoneId) {
  try {
    const value = world.getDynamicProperty(PHONE_ACTIVE_CALL_PREFIX + phoneId);
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function writePhoneCall(call) {
  world.setDynamicProperty(PHONE_CALL_PREFIX + call.id, JSON.stringify(call));
  world.setDynamicProperty(PHONE_ACTIVE_CALL_PREFIX + call.callerPhoneId, call.id);
  world.setDynamicProperty(PHONE_ACTIVE_CALL_PREFIX + call.calleePhoneId, call.id);
  const index = readPhoneCallIndex();
  if (!index.includes(call.id)) index.push(call.id);
  writePhoneCallIndex(index);
}

function clearPhoneCallStorage(call) {
  if (!call) return;
  phoneCallLastRingTick.delete(call.id);
  try { world.setDynamicProperty(PHONE_CALL_PREFIX + call.id, undefined); } catch {}
  for (const phoneId of [call.callerPhoneId, call.calleePhoneId]) {
    try {
      if (activeCallIdForPhone(phoneId) === call.id) {
        world.setDynamicProperty(PHONE_ACTIVE_CALL_PREFIX + phoneId, undefined);
      }
    } catch {}
  }
  writePhoneCallIndex(readPhoneCallIndex().filter((id) => id !== call.id));
}

function phoneCallForPhone(phoneId) {
  const callId = activeCallIdForPhone(phoneId);
  if (!callId) return undefined;
  const call = readPhoneCall(callId);
  if (!call || (call.callerPhoneId !== phoneId && call.calleePhoneId !== phoneId)) {
    try { world.setDynamicProperty(PHONE_ACTIVE_CALL_PREFIX + phoneId, undefined); } catch {}
    return undefined;
  }
  return call;
}

function findPhoneHolder(phoneId) {
  for (const candidate of world.getAllPlayers()) {
    if (playerHasPhoneId(candidate, phoneId)) return candidate;
  }
  return undefined;
}

function playerHoldsPhoneId(player, phoneId) {
  if (!player || !phoneId) return false;
  try {
    const eq = equippable(player);
    if (slotHasPhoneId(eq?.getEquipmentSlot(EquipmentSlot.Mainhand), phoneId)) return true;
    if (slotHasPhoneId(eq?.getEquipmentSlot(EquipmentSlot.Offhand), phoneId)) return true;
  } catch {}
  return false;
}

function findOnlinePlayerById(playerId) {
  const wanted = String(playerId ?? "").trim();
  if (!wanted) return undefined;
  for (const candidate of world.getAllPlayers()) {
    try {
      if (candidate.id === wanted) return candidate;
    } catch {}
  }
  return undefined;
}

function resolvePhoneAlias(ownerPhoneId, otherPhoneId) {
  try {
    const contacts = readPhoneContacts(ownerPhoneId);
    const saved = contacts.find((entry) => entry.phoneId === otherPhoneId);
    if (saved?.name) return saved.name;
  } catch {}
  return "";
}

function callDisplayForPhone(ownerPhoneId, call) {
  if (!call) return { name: "", number: "----" };
  const isCaller = call.callerPhoneId === ownerPhoneId;
  const otherPhoneId = isCaller ? call.calleePhoneId : call.callerPhoneId;
  if (!isCaller && call.anonymous) {
    return { name: ANONYMOUS_NAME, number: ANONYMOUS_NUMBER };
  }
  const other = readPhoneProfile(otherPhoneId);
  return {
    name: resolvePhoneAlias(ownerPhoneId, otherPhoneId),
    number: other?.number || "----",
  };
}

function notifyPhoneHolder(phoneId, text) {
  for (const target of world.getAllPlayers()) {
    if (!playerHasPhoneId(target, phoneId)) continue;
    try { target.sendMessage(text); } catch {}
  }
}

function dialPhoneCall(callerProfile, targetProfile, anonymous, callerPlayer = undefined) {
  if (!callerProfile || !targetProfile) return { error: "ไม่พบข้อมูลโทรศัพท์" };
  if (callerProfile.id === targetProfile.id) return { error: "ไม่สามารถโทรหาเบอร์ของตัวเองได้" };
  if (phoneCallForPhone(callerProfile.id)) return { error: "โทรศัพท์เครื่องนี้กำลังมีสายอยู่" };
  if (phoneCallForPhone(targetProfile.id)) return { error: "ปลายทางกำลังติดสาย" };
  const targetHolder = findPhoneHolder(targetProfile.id);
  if (!targetHolder) return { error: "ไม่พบผู้ถือโทรศัพท์ปลายทางออนไลน์" };

  const call = {
    id: createPhoneCallId(),
    callerPhoneId: callerProfile.id,
    calleePhoneId: targetProfile.id,
    anonymous: anonymous === true,
    status: "ringing",
    createdAt: Date.now(),
    expiresAt: Date.now() + PHONE_CALL_RING_MS,
    acceptedAt: 0,
    callerSpeaker: false,
    calleeSpeaker: false,
    callerPlayerId: String(callerPlayer?.id ?? findPhoneHolder(callerProfile.id)?.id ?? ""),
    calleePlayerId: String(targetHolder.id ?? ""),
  };

  try {
    writePhoneCall(call);
  } catch (e) {
    console.warn(`[VCMumbleItem/BP] call create failed: ${e}`);
    return { error: "เริ่มการโทรไม่สำเร็จ" };
  }

  const incoming = callDisplayForPhone(targetProfile.id, call);
  const incomingText = call.anonymous
    ? `§b[ SleepyPhone ]§r มีสายเข้าจาก ${ANONYMOUS_NAME} ${ANONYMOUS_NUMBER}`
    : incoming.name
      ? `§b[ SleepyPhone ]§r มีสายเข้าจาก ${incoming.name} ${incoming.number}`
      : `§b[ SleepyPhone ]§r มีสายเข้าจากเบอร์ ${incoming.number}`;
  notifyPhoneHolder(targetProfile.id, incomingText);
  playPhoneSound(targetHolder, PHONE_RING_SOUND, 0.95);
  phoneCallLastRingTick.set(call.id, system.currentTick);
  return { call };
}

function acceptPhoneCall(call, calleePhoneId, calleePlayer = undefined) {
  if (!call || call.status !== "ringing" || call.calleePhoneId !== calleePhoneId) return false;
  if (Date.now() > call.expiresAt) {
    clearPhoneCallStorage(call);
    return false;
  }
  if (!findPhoneHolder(call.callerPhoneId)) {
    clearPhoneCallStorage(call);
    return false;
  }
  call.status = "active";
  call.acceptedAt = Date.now();
  call.expiresAt = 0;
  if (calleePlayer?.id) call.calleePlayerId = String(calleePlayer.id);
  writePhoneCall(call);
  notifyPhoneHolder(call.callerPhoneId, "§b[ SleepyPhone ]§r รับสายแล้ว");
  syncPhoneCallTags();
  return true;
}

function finishPhoneCall(call, byPhoneId = "", reason = "วางสายแล้ว") {
  if (!call) return;
  const otherPhoneId = byPhoneId === call.callerPhoneId ? call.calleePhoneId : call.callerPhoneId;
  clearPhoneCallStorage(call);
  syncPhoneCallTags();
  if (byPhoneId && otherPhoneId) {
    notifyPhoneHolder(otherPhoneId, `§b[ SleepyPhone ]§r ${reason}`);
  }
}

function syncPhoneCallTags() {
  const desired = new Map();
  const calls = readPhoneCallIndex()
    .map((id) => readPhoneCall(id))
    .filter((call) => call?.status === "active");

  for (const call of calls) {
    const caller = findPhoneHolder(call.callerPhoneId);
    const callee = findPhoneHolder(call.calleePhoneId);
    if (!caller || !callee) continue;
    if (!desired.has(caller.id)) desired.set(caller.id, new Set());
    if (!desired.has(callee.id)) desired.set(callee.id, new Set());
    desired.get(caller.id).add(`${PHONE_CALL_TAG_PREFIX}${call.id}.a.${call.callerSpeaker ? 1 : 0}`);
    desired.get(callee.id).add(`${PHONE_CALL_TAG_PREFIX}${call.id}.b.${call.calleeSpeaker ? 1 : 0}`);
  }

  for (const target of world.getAllPlayers()) {
    const wanted = desired.get(target.id) ?? new Set();
    let existing = [];
    try { existing = target.getTags().filter((tag) => tag.startsWith(PHONE_CALL_TAG_PREFIX)); } catch {}
    for (const tag of existing) {
      if (wanted.has(tag)) continue;
      try { target.removeTag(tag); } catch {}
    }
    for (const tag of wanted) {
      if (existing.includes(tag)) continue;
      try { target.addTag(tag); } catch {}
    }
  }
}

function resetPhoneCallsOnLoad() {
  for (const callId of readPhoneCallIndex()) {
    const call = readPhoneCall(callId);
    if (call) clearPhoneCallStorage(call);
  }
  writePhoneCallIndex([]);
  for (const target of world.getAllPlayers()) {
    try {
      for (const tag of target.getTags()) {
        if (tag.startsWith(PHONE_CALL_TAG_PREFIX)) target.removeTag(tag);
      }
    } catch {}
  }
}

function maintainPhoneCalls() {
  const now = Date.now();
  for (const callId of readPhoneCallIndex()) {
    const call = readPhoneCall(callId);
    if (!call) {
      writePhoneCallIndex(readPhoneCallIndex().filter((id) => id !== callId));
      continue;
    }

    const callerHolder = findPhoneHolder(call.callerPhoneId);
    const calleeHolder = findPhoneHolder(call.calleePhoneId);
    const callerPlayer = findOnlinePlayerById(call.callerPlayerId) ?? callerHolder;
    const calleePlayer = findOnlinePlayerById(call.calleePlayerId) ?? calleeHolder;

    if (!callerPlayer || !calleePlayer) {
      clearPhoneCallStorage(call);
      const remaining = callerPlayer ?? calleePlayer;
      if (remaining) {
        try { remaining.sendMessage("§b[ SleepyPhone ]§r ปลายสายหลุด"); } catch {}
      }
      continue;
    }

    // Caller keeps the exact call phone in hand while ringing. The receiver may
    // keep it in inventory until answering. Once active, both sides must hold it.
    const callerHolding = playerHoldsPhoneId(callerPlayer, call.callerPhoneId);
    const calleeHolding = playerHoldsPhoneId(calleePlayer, call.calleePhoneId);
    const calleeStillHasPhone = playerHasPhoneId(calleePlayer, call.calleePhoneId);
    const offender = !callerHolding
      ? callerPlayer
      : (!calleeStillHasPhone || (call.status === "active" && !calleeHolding) ? calleePlayer : undefined);
    if (offender) {
      const offenderIsCaller = offender.id === callerPlayer.id;
      const other = offenderIsCaller ? calleePlayer : callerPlayer;
      clearPhoneCallStorage(call);
      try { offender.sendMessage("§b[ SleepyPhone ]§r สายหลุด เพราะไม่ได้ถือโทรศัพท์ไว้"); } catch {}
      try { other.sendMessage("§b[ SleepyPhone ]§r ปลายสายหลุด อาจไม่ได้ถือโทรศัพท์ไว้"); } catch {}
      continue;
    }

    if (call.status === "ringing") {
      const lastRing = phoneCallLastRingTick.get(call.id) ?? -PHONE_RING_INTERVAL_TICKS;
      if (system.currentTick - lastRing >= PHONE_RING_INTERVAL_TICKS) {
        playPhoneSound(calleePlayer, PHONE_RING_SOUND, 0.95);
        phoneCallLastRingTick.set(call.id, system.currentTick);
      }
    }

    if (call.status === "ringing" && now > call.expiresAt) {
      clearPhoneCallStorage(call);
      notifyPhoneHolder(call.callerPhoneId, "§b[ SleepyPhone ]§r ไม่มีผู้รับสาย");
    }
  }
  syncPhoneCallTags();
}

const openPhonePlayers = new Set();

async function showPhone(player) {
  if (!player) return;
  let playerId = "";
  let playerName = "unknown";
  try {
    playerId = String(player.id ?? "");
    playerName = String(player.name ?? "unknown");
  } catch {
    return;
  }
  if (!playerId || openPhonePlayers.has(playerId)) return;
  if (openSettingsPlayers.has(playerId)) {
    try { player.sendMessage("§e[SleepyPhone] กรุณาปิดหน้าตั้งค่า Mic ก่อน§r"); } catch {}
    return;
  }

  const initial = resolvePhoneProfile(player);
  if (!initial.slot) {
    player.sendMessage("§c[SleepyPhone] ไม่พบโทรศัพท์ที่กำลังใช้งาน§r");
    return;
  }

  openPhonePlayers.add(playerId);
  let phoneRefreshId;
  try {
    const pageNames = [
      "setupName", "setupNumber", "home", "sendMethod", "sendNumber", "contacts",
      "addContact", "contactDetail", "deleteContact", "compose", "inbox", "messageDetail", "conversation",
      "callMethod", "callNumber", "callSetup", "incomingCall", "outgoingCall", "activeCall",
    ];
    const pages = Object.fromEntries(
      pageNames.map((name) => [name, new ObservableBoolean(false)])
    );

    let currentPhonePage = "";
    let syncDynamicButtonVisibility = () => {};
    const showPage = (name) => {
      currentPhonePage = name;
      for (const pageName of pageNames) pages[pageName].setData(pageName === name);
      syncDynamicButtonVisibility();
    };

    if (initial.profile) showPage("home");
    else showPage("setupName");

    const icNameInput = new ObservableString(initial.profile?.icName ?? "", { clientWritable: true });
    const numberInput = new ObservableString(initial.profile?.number ?? "", { clientWritable: true });
    const setupStatus = new ObservableString("");
    const setupNameText = new ObservableString("");
    const identityText = new ObservableString("");
    const homeStatus = new ObservableString("");

    const directNumberInput = new ObservableString("", { clientWritable: true });
    const directNumberStatus = new ObservableString("");

    const contactSummary = new ObservableString("");
    const contactEmptyText = new ObservableString("");
    const favoritesInfo = new ObservableString("\nรายชื่อที่ถูกเพิ่มรายการโปรดจะมาอยู่ตรงนี้\n");
    const addContactNameInput = new ObservableString("", { clientWritable: true });
    const addContactNumberInput = new ObservableString("", { clientWritable: true });
    const addContactStatus = new ObservableString("");
    const contactDetailText = new ObservableString("");
    const contactDetailStatus = new ObservableString("");
    const contactFavoriteActionLabel = new ObservableString("เพิ่มรายการโปรด");
    const deleteContactText = new ObservableString("");

    const composeRecipientText = new ObservableString("");
    const composeInput = new ObservableString("", { clientWritable: true });
    const anonymousToggle = new ObservableBoolean(false, { clientWritable: true });
    const composeStatus = new ObservableString("");

    const inboxHomeButtonLabel = new ObservableString("กล่องข้อความ");
    const inboxSummary = new ObservableString("");
    const inboxEmptyText = new ObservableString("");
    const messageDetailText = new ObservableString("");
    const messageDetailStatus = new ObservableString("");
    const conversationTitleText = new ObservableString("");
    const conversationHistoryText = new ObservableString("");
    const conversationInput = new ObservableString("", { clientWritable: true });
    const conversationStatus = new ObservableString("");
    const conversationOlderVisible = new ObservableBoolean(false);
    const conversationNewerVisible = new ObservableBoolean(false);

    const callNumberInput = new ObservableString("", { clientWritable: true });
    const callNumberStatus = new ObservableString("");
    const callSetupText = new ObservableString("");
    const callAnonymousToggle = new ObservableBoolean(false, { clientWritable: true });
    const callSetupStatus = new ObservableString("");
    const incomingCallText = new ObservableString("");
    const incomingCallStatus = new ObservableString("");
    const outgoingCallText = new ObservableString("");
    const outgoingCallStatus = new ObservableString("");
    const activeCallText = new ObservableString("");
    const activeCallStatus = new ObservableString("");
    const speakerActionLabel = new ObservableString("เปิดลำโพง");

    const contactButtonLabels = [];
    const contactButtonVisible = [];
    const favoriteButtonLabels = [];
    const favoriteButtonVisible = [];
    const inboxButtonLabels = [];
    const inboxButtonVisible = [];
    const contactButtonHasData = Array(PHONE_CONTACT_LIMIT).fill(false);
    const favoriteButtonHasData = Array(PHONE_CONTACT_LIMIT).fill(false);
    const inboxButtonHasData = Array(PHONE_INBOX_LIMIT).fill(false);
    for (let i = 0; i < PHONE_CONTACT_LIMIT; i++) {
      contactButtonLabels.push(new ObservableString(""));
      contactButtonVisible.push(new ObservableBoolean(false));
      favoriteButtonLabels.push(new ObservableString(""));
      favoriteButtonVisible.push(new ObservableBoolean(false));
    }
    for (let i = 0; i < PHONE_INBOX_LIMIT; i++) {
      inboxButtonLabels.push(new ObservableString(""));
      inboxButtonVisible.push(new ObservableBoolean(false));
    }

    let pendingIcName = initial.profile?.icName ?? "";
    let activeProfile = initial.profile;
    let contactsCache = [];
    let favoritesCache = [];
    let inboxCache = [];
    let conversationCache = [];
    let inboxEntries = [];
    let selectedConversationId = "";
    let conversationPageOffset = 0;
    let selectedContact = undefined;
    let contactDetailBackPage = "contacts";
    let selectedMessage = undefined;
    let composeRecipient = undefined;
    let addContactBusy = false;
    let contactsBackPage = "sendMethod";
    let callRecipient = undefined;
    let lastConversationRefreshTick = 0;

    // DDUI list buttons are created once and persist for the lifetime of the form.
    // Their visibility therefore has to be scoped to both the page and whether
    // that list slot currently contains data. Otherwise a normal contact button
    // can leak into Home, Send by Number, Inbox, or appear under Favorites.
    syncDynamicButtonVisibility = () => {
      for (let i = 0; i < PHONE_CONTACT_LIMIT; i++) {
        contactButtonVisible[i].setData(
          currentPhonePage === "contacts" && contactButtonHasData[i] === true
        );
        favoriteButtonVisible[i].setData(
          currentPhonePage === "home" && favoriteButtonHasData[i] === true
        );
      }
      for (let i = 0; i < PHONE_INBOX_LIMIT; i++) {
        inboxButtonVisible[i].setData(
          currentPhonePage === "inbox" && inboxButtonHasData[i] === true
        );
      }
    };
    syncDynamicButtonVisibility();

    const refreshIdentityText = () => {
      if (!activeProfile) {
        identityText.setData("");
        return;
      }
      identityText.setData(`\nชื่อ: §f${activeProfile.icName}§r\n\nเบอร์: §b${activeProfile.number}§r`);
    };

    const refreshContacts = () => {
      if (!activeProfile) return;
      contactsCache = readPhoneContacts(activeProfile.id);
      contactSummary.setData(`\nรายชื่อทั้งหมด: §b${contactsCache.length}§r\n`);
      contactEmptyText.setData(
        contactsCache.length === 0 ? "\nยังไม่มีรายชื่องั้นหรอเพิ่มเลยสิ\n" : ""
      );

      for (let i = 0; i < PHONE_CONTACT_LIMIT; i++) {
        const contact = contactsCache[i];
        if (contact) {
          const current = readPhoneProfile(contact.phoneId);
          if (current && current.number === contact.number) {
            contact.number = current.number;
          }
          contactButtonLabels[i].setData(`${contact.name} - ${contact.number}`);
          contactButtonHasData[i] = true;
        } else {
          contactButtonLabels[i].setData("");
          contactButtonHasData[i] = false;
        }
      }

      favoritesCache = contactsCache.filter((contact) => contact.favorite === true);
      favoritesInfo.setData(
        favoritesCache.length === 0 ? "\nรายชื่อที่ถูกเพิ่มรายการโปรดจะมาอยู่ตรงนี้\n" : ""
      );
      for (let i = 0; i < PHONE_CONTACT_LIMIT; i++) {
        const favorite = favoritesCache[i];
        if (favorite) {
          favoriteButtonLabels[i].setData(`${favorite.name} - ${favorite.number}`);
          favoriteButtonHasData[i] = true;
        } else {
          favoriteButtonLabels[i].setData("");
          favoriteButtonHasData[i] = false;
        }
      }
      syncDynamicButtonVisibility();
    };

    const refreshInbox = () => {
      if (!activeProfile) return;
      try { migrateLegacyInboxToConversations(activeProfile.id); } catch {}
      conversationCache = readPhoneConversations(activeProfile.id);
      inboxCache = readPhoneInbox(activeProfile.id).filter((message) => message.anonymous === true);

      const conversationEntries = conversationCache.map((meta) => ({
        kind: "conversation",
        timestamp: meta.lastMessageAt,
        meta,
      }));
      const anonymousEntries = inboxCache.map((message) => ({
        kind: "anonymous",
        timestamp: message.timestamp,
        message,
      }));
      inboxEntries = conversationEntries.concat(anonymousEntries)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, PHONE_INBOX_LIMIT);

      const conversationUnread = conversationCache.reduce(
        (sum, meta) => sum + conversationUnreadForPhone(meta, activeProfile.id),
        0
      );
      const anonymousUnread = inboxCache.filter((message) => !message.read).length;
      const unread = conversationUnread + anonymousUnread;
      inboxHomeButtonLabel.setData(unread > 0 ? `[${unread}] กล่องข้อความ` : "กล่องข้อความ");
      inboxSummary.setData(
        `\nการสนทนา: §b${conversationCache.length}§r\n\nยังไม่อ่าน: §c${unread}§r\n`
      );
      inboxEmptyText.setData(inboxEntries.length === 0 ? "\nยังไม่มีข้อความ\n" : "");

      for (let i = 0; i < PHONE_INBOX_LIMIT; i++) {
        const entry = inboxEntries[i];
        if (!entry) {
          inboxButtonLabels[i].setData("");
          inboxButtonHasData[i] = false;
          continue;
        }

        if (entry.kind === "conversation") {
          const meta = entry.meta;
          const display = conversationDisplay(activeProfile.id, meta);
          const unreadCount = conversationUnreadForPhone(meta, activeProfile.id);
          const prefix = unreadCount > 0 ? "[!] " : "";
          const label = display.name ? `${display.name} - ${display.number}` : `${display.number}`;
          inboxButtonLabels[i].setData(`${prefix}${label}`);
        } else {
          const message = entry.message;
          const prefix = message.read ? "" : "[!] ";
          inboxButtonLabels[i].setData(`${prefix}${ANONYMOUS_NAME} - ${ANONYMOUS_NUMBER}`);
        }
        inboxButtonHasData[i] = true;
      }
      syncDynamicButtonVisibility();
    };

    const showNamePage = () => {
      setupStatus.setData("");
      showPage("setupName");
    };

    const showNumberPage = () => {
      const name = normalizeIcName(icNameInput.getData());
      if (!name) {
        setupStatus.setData(
          `\n§cกรุณากรอกชื่อ IC 1-${PHONE_NAME_MAX_LENGTH} ตัวอักษร และห้ามใช้รหัสสี§r\n`
        );
        return;
      }
      pendingIcName = name;
      setupNameText.setData(`\nชื่อ IC: §f${pendingIcName}§r\n`);
      setupStatus.setData("");
      showPage("setupNumber");
    };

    const finishRegistration = (number) => {
      const slot = currentPhoneSlot(player);
      if (!slot || !isPhoneId(slot.typeId)) {
        setupStatus.setData("\n§cไม่พบโทรศัพท์ กรุณาถือโทรศัพท์แล้วลองใหม่§r\n");
        return;
      }

      const nowRegistered = phoneItemData(slot);
      if (nowRegistered) {
        activeProfile = readPhoneProfile(nowRegistered.id) ?? nowRegistered;
        refreshIdentityText();
        setupStatus.setData("");
        showPage("home");
        return;
      }

      const owner = phoneNumberOwner(number);
      if (owner) {
        setupStatus.setData(`\n§cเบอร์ ${number} ถูกใช้งานแล้ว กรุณาเลือกเบอร์อื่น§r\n`);
        return;
      }

      const profile = { id: createPhoneId(player), icName: pendingIcName, number };

      try {
        setPhoneItemIdentity(slot, profile);
        writePhoneProfile(profile);
      } catch (e) {
        console.warn(`[VCMumbleItem/BP] phone registration failed player=${player.name}: ${e}`);
        setupStatus.setData("\n§cลงทะเบียนโทรศัพท์ไม่สำเร็จ กรุณาลองใหม่§r\n");
        return;
      }

      activeProfile = profile;
      refreshIdentityText();
      homeStatus.setData("\nลงทะเบียนโทรศัพท์เรียบร้อยแล้ว\n");
      setupStatus.setData("");
      showPage("home");

      console.warn(
        `[VCMumbleItem/BP] PHONE_REGISTERED player=${player.name} phoneId=${profile.id} number=${profile.number} ic=${profile.icName}`
      );
    };

    const submitManualNumber = () => {
      const number = String(numberInput.getData() ?? "").trim();
      if (!/^\d{4}$/.test(number)) {
        setupStatus.setData("\n§cเบอร์โทรต้องเป็นตัวเลข 4 หลัก เช่น 0123 หรือ 4821§r\n");
        return;
      }
      finishRegistration(number);
    };

    const submitRandomNumber = () => {
      const number = randomAvailablePhoneNumber();
      if (!number) {
        setupStatus.setData("\n§cไม่มีเบอร์โทรว่างในระบบแล้ว§r\n");
        return;
      }
      numberInput.setData(number);
      finishRegistration(number);
    };

    const openHome = () => {
      refreshIdentityText();
      refreshContacts();
      refreshInbox();
      showPage("home");
    };

    const openSendMethod = () => {
      directNumberStatus.setData("");
      showPage("sendMethod");
    };

    const openDirectNumber = () => {
      directNumberInput.setData("");
      directNumberStatus.setData("");
      showPage("sendNumber");
    };

    const openContacts = (origin = contactsBackPage) => {
      contactsBackPage = origin || "sendMethod";
      contactDetailStatus.setData("");
      refreshContacts();
      showPage("contacts");
    };

    const backFromContacts = () => {
      if (contactsBackPage === "callMethod") showPage("callMethod");
      else showPage("sendMethod");
    };

    const openCallMethod = () => {
      callNumberStatus.setData("");
      callSetupStatus.setData("");
      showPage("callMethod");
    };

    const openCallNumber = () => {
      callNumberInput.setData("");
      callNumberStatus.setData("");
      showPage("callNumber");
    };

    const beginCallSetup = (target, displayName = undefined) => {
      if (!activeProfile || !target) return;
      if (target.id === activeProfile.id) {
        callSetupStatus.setData("\n§cไม่สามารถโทรหาเบอร์ของตัวเองได้§r\n");
        return;
      }
      callRecipient = {
        id: target.id,
        number: target.number,
        displayName: String(displayName ?? resolvePhoneAlias(activeProfile.id, target.id) ?? "").trim(),
      };
      callAnonymousToggle.setData(false);
      callSetupStatus.setData("");
      callSetupText.setData(
        callRecipient.displayName
          ? `\nโทรหา: §f${callRecipient.displayName}§r\n\nเบอร์: §b${callRecipient.number}§r\n`
          : `\nโทรไปที่เบอร์: §b${callRecipient.number}§r\n`
      );
      showPage("callSetup");
    };

    const submitCallNumber = () => {
      const number = String(callNumberInput.getData() ?? "").trim();
      if (!/^\d{4}$/.test(number)) {
        callNumberStatus.setData("\n§cกรุณากรอกเบอร์ 4 หลัก§r\n");
        return;
      }
      const target = readPhoneProfileByNumber(number);
      if (!target) {
        callNumberStatus.setData("\n§cไม่พบเบอร์นี้ หรือเกิดเหตุขัดข้อง§r\n");
        return;
      }
      if (activeProfile && target.id === activeProfile.id) {
        callNumberStatus.setData("\n§cไม่สามารถโทรหาเบอร์ของตัวเองได้§r\n");
        return;
      }
      beginCallSetup(target);
    };

    const startCall = () => {
      if (!activeProfile || !callRecipient) return;
      const target = readPhoneProfile(callRecipient.id) ?? readPhoneProfileByNumber(callRecipient.number);
      if (!target) {
        callSetupStatus.setData("\n§cไม่พบปลายทางในระบบ§r\n");
        return;
      }
      const result = dialPhoneCall(activeProfile, target, callAnonymousToggle.getData() === true, player);
      if (!result.call) {
        callSetupStatus.setData(`\n§c${result.error || "เริ่มการโทรไม่สำเร็จ"}§r\n`);
        return;
      }
      outgoingCallStatus.setData("");
      try {
        player.sendMessage(`§b[ SleepyPhone ]§r กำลังโทรไปที่เบอร์ ${target.number} ใช้โทรศัพท์เพื่อดูสถานะ`);
      } catch {}
      try { form.close(); } catch {}
    };

    const callSelectedContact = () => {
      if (!selectedContact) return;
      const target = readPhoneProfile(selectedContact.phoneId) ?? readPhoneProfileByNumber(selectedContact.number);
      if (!target) {
        contactDetailStatus.setData("\n§cไม่พบข้อมูลของรายชื่อนี้ในระบบ§r\n");
        return;
      }
      beginCallSetup(target, selectedContact.name);
    };

    const refreshCallUi = () => {
      if (!activeProfile) return undefined;
      const call = phoneCallForPhone(activeProfile.id);
      if (!call) return undefined;
      const display = callDisplayForPhone(activeProfile.id, call);

      if (call.status === "ringing") {
        const remaining = Math.max(0, Math.ceil((call.expiresAt - Date.now()) / 1000));
        if (call.calleePhoneId === activeProfile.id) {
          incomingCallText.setData(
            display.name
              ? `\nชื่อ: §f${display.name}§r\n\nเบอร์: §b${display.number}§r\n\nเวลารับสายคงเหลือ: §f${remaining} วินาที§r\n`
              : `\nเบอร์: §b${display.number}§r\n\nเวลารับสายคงเหลือ: §f${remaining} วินาที§r\n`
          );
        } else {
          outgoingCallText.setData(
            display.name
              ? `\nกำลังโทรหา: §f${display.name}§r\n\nเบอร์: §b${display.number}§r\n\nรอรับสาย: §f${remaining} วินาที§r\n`
              : `\nกำลังโทรไปที่เบอร์: §b${display.number}§r\n\nรอรับสาย: §f${remaining} วินาที§r\n`
          );
        }
      } else if (call.status === "active") {
        const speakerOn = call.callerPhoneId === activeProfile.id ? call.callerSpeaker : call.calleeSpeaker;
        const elapsed = Math.max(0, Math.floor((Date.now() - call.acceptedAt) / 1000));
        const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
        const ss = String(elapsed % 60).padStart(2, "0");
        activeCallText.setData(
          display.name
            ? `\nกำลังคุยกับ: §f${display.name}§r\n\nเบอร์: §b${display.number}§r\n\nเวลา: §f${mm}:${ss}§r\n\nลำโพง: §f${speakerOn ? "เปิด" : "ปิด"}§r\n`
            : `\nกำลังคุยกับเบอร์: §b${display.number}§r\n\nเวลา: §f${mm}:${ss}§r\n\nลำโพง: §f${speakerOn ? "เปิด" : "ปิด"}§r\n`
        );
        speakerActionLabel.setData(speakerOn ? "ปิดลำโพง" : "เปิดลำโพง");
      }
      return call;
    };

    const routeToCurrentCall = () => {
      const call = refreshCallUi();
      if (!call || !activeProfile) return false;
      if (call.status === "active") showPage("activeCall");
      else if (call.calleePhoneId === activeProfile.id) showPage("incomingCall");
      else showPage("outgoingCall");
      return true;
    };

    const acceptIncomingCall = () => {
      if (!activeProfile) return;
      const call = phoneCallForPhone(activeProfile.id);
      if (!call || !acceptPhoneCall(call, activeProfile.id, player)) {
        incomingCallStatus.setData("\n§cสายนี้หมดเวลาแล้ว หรือผู้โทรไม่ได้ออนไลน์§r\n");
        system.runTimeout(openHome, 20);
        return;
      }
      activeCallStatus.setData("");
      try { form.close(); } catch {}
    };

    const rejectIncomingCall = () => {
      if (!activeProfile) return;
      const call = phoneCallForPhone(activeProfile.id);
      if (call) finishPhoneCall(call, activeProfile.id, "ปฏิเสธสายแล้ว");
      openHome();
    };

    const cancelOutgoingCall = () => {
      if (!activeProfile) return;
      const call = phoneCallForPhone(activeProfile.id);
      if (call) finishPhoneCall(call, activeProfile.id, "ยกเลิกการโทรแล้ว");
      openHome();
    };

    const toggleCallSpeaker = () => {
      if (!activeProfile) return;
      const call = phoneCallForPhone(activeProfile.id);
      if (!call || call.status !== "active") {
        activeCallStatus.setData("\n§cไม่มีสายที่กำลังคุยอยู่§r\n");
        return;
      }
      if (call.callerPhoneId === activeProfile.id) call.callerSpeaker = !call.callerSpeaker;
      else call.calleeSpeaker = !call.calleeSpeaker;
      try { writePhoneCall(call); } catch {}
      syncPhoneCallTags();
      refreshCallUi();
      activeCallStatus.setData(
        (call.callerPhoneId === activeProfile.id ? call.callerSpeaker : call.calleeSpeaker)
          ? `\nเปิดลำโพงแล้ว เสียงอีกฝ่ายจะได้ยินรอบโทรศัพท์ไม่เกิน ${PHONE_SPEAKER_RADIUS} บล็อก\n`
          : "\nปิดลำโพงแล้ว เสียงจากสายจะได้ยินเฉพาะผู้ถือโทรศัพท์\n"
      );
    };

    const hangupActiveCall = () => {
      if (!activeProfile) return;
      const call = phoneCallForPhone(activeProfile.id);
      if (call) finishPhoneCall(call, activeProfile.id, "วางสายแล้ว");
      openHome();
    };

    const openAddContact = () => {
      addContactNameInput.setData("");
      addContactNumberInput.setData("");
      addContactStatus.setData("\nสถานะ: รอข้อมูล\n");
      addContactBusy = false;
      showPage("addContact");
    };

    const openContactDetail = (contact, backPage = "contacts") => {
      if (!contact) return;
      selectedContact = contact;
      contactDetailBackPage = backPage;
      contactDetailStatus.setData("");
      const current = readPhoneProfile(contact.phoneId) ?? readPhoneProfileByNumber(contact.number);
      const realName = current?.icName || contact.name;
      contactDetailText.setData(
        `\nชื่อที่ตั้ง: §f${contact.name}§r\n\nชื่อจริง: §f${realName}§r\n\nเบอร์: §b${contact.number}§r\n`
      );
      contactFavoriteActionLabel.setData(
        contact.favorite === true ? "ลบออกจากรายการโปรด" : "เพิ่มรายการโปรด"
      );
      showPage("contactDetail");
    };

    const openContactAt = (index) => {
      refreshContacts();
      openContactDetail(contactsCache[index], "contacts");
    };

    const openFavoriteAt = (index) => {
      refreshContacts();
      openContactDetail(favoritesCache[index], "home");
    };

    const beginDeleteContact = () => {
      if (!selectedContact) return;
      const current = readPhoneProfile(selectedContact.phoneId) ?? readPhoneProfileByNumber(selectedContact.number);
      const realName = current?.icName || selectedContact.name;
      deleteContactText.setData(
        `\nต้องการลบรายชื่อนี้หรือไม่\n\nชื่อที่ตั้ง: §f${selectedContact.name}§r\n\nชื่อจริง: §f${realName}§r\n\nเบอร์: §b${selectedContact.number}§r\n`
      );
      showPage("deleteContact");
    };

    const confirmDeleteContact = () => {
      if (!activeProfile || !selectedContact) return;
      const returnPage = contactDetailBackPage;
      const contacts = readPhoneContacts(activeProfile.id).filter(
        (entry) => !(entry.phoneId === selectedContact.phoneId && entry.number === selectedContact.number)
      );
      try {
        writePhoneContacts(activeProfile.id, contacts);
        selectedContact = undefined;
        refreshContacts();
        if (returnPage === "home") openHome();
        else if (returnPage === "sendMethod") showPage("sendMethod");
        else showPage("contacts");
      } catch (e) {
        console.warn(`[VCMumbleItem/BP] contact delete failed player=${player.name}: ${e}`);
        contactDetailStatus.setData("\n§cลบรายชื่อไม่สำเร็จ กรุณาลองใหม่§r\n");
        showPage("contactDetail");
      }
    };

    const submitAddContact = () => {
      if (!activeProfile || addContactBusy) return;
      addContactBusy = true;
      addContactStatus.setData("\nสถานะ: §eกำลังดำเนินการ...§r\n");

      system.run(() => {
        try {
          const number = String(addContactNumberInput.getData() ?? "").trim();
          const customName = normalizeContactName(addContactNameInput.getData());

          if (!/^\d{4}$/.test(number)) {
            addContactStatus.setData("\nสถานะ: §cเบอร์ต้องเป็นตัวเลข 4 หลัก§r\n");
            addContactBusy = false;
            return;
          }
          if (customName === undefined) {
            addContactStatus.setData(
              `\nสถานะ: §cชื่อรายชื่อต้องไม่เกิน ${PHONE_CONTACT_NAME_MAX_LENGTH} ตัวอักษร และห้ามใช้รหัสสี§r\n`
            );
            addContactBusy = false;
            return;
          }

          const target = readPhoneProfileByNumber(number);
          if (!target) {
            addContactStatus.setData("\nสถานะ: §cไม่พบเบอร์นี้ หรือเกิดเหตุขัดข้อง§r\n");
            addContactBusy = false;
            return;
          }
          if (target.id === activeProfile.id) {
            addContactStatus.setData("\nสถานะ: §cไม่สามารถเพิ่มเบอร์ของตัวเองได้§r\n");
            addContactBusy = false;
            return;
          }

          const contacts = readPhoneContacts(activeProfile.id);
          if (contacts.some((entry) => entry.phoneId === target.id || entry.number === target.number)) {
            addContactStatus.setData("\nสถานะ: §eมีรายชื่อนี้อยู่แล้ว§r\n");
            addContactBusy = false;
            return;
          }
          if (contacts.length >= PHONE_CONTACT_LIMIT) {
            addContactStatus.setData(`\nสถานะ: §cรายชื่อเต็มแล้ว สูงสุด ${PHONE_CONTACT_LIMIT} รายชื่อ§r\n`);
            addContactBusy = false;
            return;
          }

          contacts.push({
            phoneId: target.id,
            name: customName || target.icName,
            number: target.number,
            createdAt: Date.now(),
            favorite: false,
          });
          writePhoneContacts(activeProfile.id, contacts);
          addContactStatus.setData("\nสถานะ: §aเพิ่มรายชื่อสำเร็จ§r\n");
          refreshContacts();

          system.runTimeout(() => {
            addContactBusy = false;
            showPage("contacts");
          }, 20);
        } catch (e) {
          console.warn(`[VCMumbleItem/BP] add contact failed player=${player.name}: ${e}`);
          addContactStatus.setData("\nสถานะ: §cเกิดเหตุขัดข้อง กรุณาลองใหม่§r\n");
          addContactBusy = false;
        }
      });
    };

    const beginCompose = (targetProfile, displayName = undefined) => {
      if (!targetProfile) return;
      composeRecipient = {
        id: targetProfile.id,
        icName: targetProfile.icName,
        number: targetProfile.number,
        displayName: String(displayName ?? resolvePhoneAlias(activeProfile?.id ?? "", targetProfile.id) ?? "").trim(),
      };
      composeInput.setData("");
      anonymousToggle.setData(false);
      composeStatus.setData("");
      composeRecipientText.setData(
        composeRecipient.displayName
          ? `\nถึง: §f${composeRecipient.displayName}§r\n\nเบอร์: §b${composeRecipient.number}§r\n`
          : `\nถึงเบอร์: §b${composeRecipient.number}§r\n`
      );
      showPage("compose");
    };

    const submitDirectNumber = () => {
      const number = String(directNumberInput.getData() ?? "").trim();
      if (!/^\d{4}$/.test(number)) {
        directNumberStatus.setData("\n§cกรุณากรอกเบอร์ 4 หลัก§r\n");
        return;
      }
      const target = readPhoneProfileByNumber(number);
      if (!target) {
        directNumberStatus.setData("\n§cไม่พบเบอร์นี้ หรือเกิดเหตุขัดข้อง§r\n");
        return;
      }
      beginCompose(target);
    };

    const composeSelectedContact = () => {
      if (!selectedContact) return;
      const target = readPhoneProfile(selectedContact.phoneId) ?? readPhoneProfileByNumber(selectedContact.number);
      if (!target) {
        contactDetailStatus.setData("\n§cไม่พบข้อมูลของรายชื่อนี้ในระบบ§r\n");
        return;
      }
      beginCompose(target, selectedContact.name);
    };

    const toggleSelectedContactFavorite = () => {
      if (!activeProfile || !selectedContact) return;
      try {
        const contacts = readPhoneContacts(activeProfile.id);
        const target = contacts.find(
          (entry) => entry.phoneId === selectedContact.phoneId && entry.number === selectedContact.number
        );
        if (!target) {
          contactDetailStatus.setData("\n§cไม่พบข้อมูลของรายชื่อนี้ กรุณาลองใหม่§r\n");
          return;
        }

        target.favorite = target.favorite !== true;
        writePhoneContacts(activeProfile.id, contacts);
        selectedContact.favorite = target.favorite;
        contactFavoriteActionLabel.setData(
          target.favorite ? "ลบออกจากรายการโปรด" : "เพิ่มรายการโปรด"
        );
        contactDetailStatus.setData(
          target.favorite ? "\n§aเพิ่มลง Favorites แล้ว§r\n" : "\n§aลบออกจาก Favorites แล้ว§r\n"
        );
        refreshContacts();
      } catch (e) {
        console.warn(`[VCMumbleItem/BP] favorite update failed player=${player.name}: ${e}`);
        contactDetailStatus.setData("\n§cอัปเดตรายการโปรดไม่สำเร็จ กรุณาลองใหม่§r\n");
      }
    };

    const backFromContactDetail = () => {
      if (contactDetailBackPage === "home") openHome();
      else if (contactDetailBackPage === "sendMethod") openSendMethod();
      else openContacts();
    };

    const renderConversation = (markRead = true) => {
      if (!activeProfile || !selectedConversationId) return;
      if (markRead) markConversationRead(selectedConversationId, activeProfile.id);
      const window = readConversationWindow(selectedConversationId, conversationPageOffset);
      const meta = window.meta;
      if (!meta) {
        conversationStatus.setData("\n§cไม่พบการสนทนานี้แล้ว§r\n");
        return;
      }
      const display = conversationDisplay(activeProfile.id, meta);
      conversationTitleText.setData(
        display.name
          ? `\n${display.name}\n\nเบอร์: §b${display.number}§r\n`
          : `\nเบอร์: §b${display.number}§r\n`
      );

      const otherReadAt = conversationOtherReadAt(meta, activeProfile.id);
      const blocks = [];
      for (const message of window.messages) {
        const stamp = formatPhoneMessageTime(message.timestamp);
        const mine = message.senderPhoneId === activeProfile.id;
        const latest = message.id === meta.lastMessageId;
        const color = latest ? "§f" : "§7";
        const senderLabel = mine ? "เรา" : (display.name || `เบอร์ ${display.number}`);
        let status = "";
        if (mine) {
          if (otherReadAt >= message.timestamp) {
            const readStamp = formatPhoneMessageTime(otherReadAt);
            status = `\nสถานะ: อ่านแล้ว ${readStamp.time}`;
          } else {
            status = "\nสถานะ: ส่งแล้ว";
          }
        }
        blocks.push(
          `${color}${stamp.date} ${stamp.time}\n${senderLabel}:\n${message.body}${status}§r`
        );
      }
      conversationHistoryText.setData(
        blocks.length ? `\n${blocks.join("\n\n")}\n` : "\nยังไม่มีข้อความในแชทนี้\n"
      );
      conversationOlderVisible.setData(window.hasOlder);
      conversationNewerVisible.setData(window.hasNewer);
      conversationStatus.setData("");
    };

    const openConversation = (conversationId) => {
      selectedConversationId = String(conversationId ?? "");
      conversationPageOffset = 0;
      conversationInput.setData("");
      showPage("conversation");
      renderConversation(true);
      refreshInbox();
    };

    const openOlderConversationMessages = () => {
      if (!selectedConversationId) return;
      const current = readConversationWindow(selectedConversationId, conversationPageOffset);
      if (!current.hasOlder) return;
      conversationPageOffset += 1;
      renderConversation(true);
    };

    const openNewerConversationMessages = () => {
      if (!selectedConversationId || conversationPageOffset <= 0) return;
      conversationPageOffset -= 1;
      renderConversation(true);
    };

    const sendConversationMessage = () => {
      if (!activeProfile || !selectedConversationId) return;
      const body = normalizeMessage(conversationInput.getData());
      if (!body) {
        conversationStatus.setData(
          `\n§cกรุณากรอกข้อความ 1-${PHONE_MESSAGE_MAX_LENGTH} ตัวอักษร และห้ามใช้รหัสสี§r\n`
        );
        return;
      }
      const meta = readConversationMeta(selectedConversationId);
      const targetPhoneId = otherConversationPhoneId(meta, activeProfile.id);
      const target = readPhoneProfile(targetPhoneId);
      if (!meta || !target) {
        conversationStatus.setData("\n§cไม่พบปลายทางของแชทนี้§r\n");
        return;
      }
      try {
        const result = appendConversationMessage(activeProfile, target, body);
        if (!result) throw new Error("conversation append failed");
        const message = {
          id: result.message.id,
          senderPhoneId: activeProfile.id,
          senderName: activeProfile.icName,
          senderNumber: activeProfile.number,
          anonymous: false,
          body,
          timestamp: result.message.timestamp,
          read: false,
        };
        notifyPhoneRecipient(target.id, message);
        conversationInput.setData("");
        conversationPageOffset = 0;
        renderConversation(false);
        refreshInbox();
      } catch (e) {
        console.warn(`[VCMumbleItem/BP] conversation send failed player=${playerName}: ${e}`);
        conversationStatus.setData("\n§cส่งข้อความไม่สำเร็จ กรุณาลองใหม่§r\n");
      }
    };

    const openInboxEntryAt = (index) => {
      refreshInbox();
      const entry = inboxEntries[index];
      if (!entry) return;
      if (entry.kind === "conversation") openConversation(entry.meta.id);
      else {
        const legacyIndex = inboxCache.findIndex((message) => message.id === entry.message.id);
        if (legacyIndex >= 0) openMessageAt(legacyIndex);
      }
    };

    const sendComposedMessage = () => {
      if (!activeProfile || !composeRecipient) return;
      const body = normalizeMessage(composeInput.getData());
      if (!body) {
        composeStatus.setData(
          `\n§cกรุณากรอกข้อความ 1-${PHONE_MESSAGE_MAX_LENGTH} ตัวอักษร และห้ามใช้รหัสสี§r\n`
        );
        return;
      }

      const target = readPhoneProfile(composeRecipient.id) ?? readPhoneProfileByNumber(composeRecipient.number);
      if (!target) {
        composeStatus.setData("\n§cไม่พบผู้รับในระบบ หรือเกิดเหตุขัดข้อง§r\n");
        return;
      }

      const anonymous = anonymousToggle.getData() === true;
      const visibleName = anonymous ? ANONYMOUS_NAME : activeProfile.icName;
      const visibleNumber = anonymous ? ANONYMOUS_NUMBER : activeProfile.number;
      const message = {
        id: createMessageId(),
        senderPhoneId: activeProfile.id,
        senderName: visibleName,
        senderNumber: visibleNumber,
        anonymous,
        body,
        timestamp: Date.now(),
        read: false,
      };

      try {
        if (anonymous) {
          const inbox = readPhoneInbox(target.id);
          inbox.unshift(message);
          writePhoneInbox(target.id, inbox);
          notifyPhoneRecipient(target.id, message);
          composeStatus.setData("\n§aส่งข้อความแบบไม่ระบุตัวตนสำเร็จ§r\n");
          composeInput.setData("");
          system.runTimeout(() => openSendMethod(), 20);
        } else {
          const result = appendConversationMessage(activeProfile, target, body);
          if (!result) throw new Error("conversation append failed");
          message.id = result.message.id;
          message.timestamp = result.message.timestamp;
          notifyPhoneRecipient(target.id, message);
          composeInput.setData("");
          selectedConversationId = result.meta.id;
          conversationPageOffset = 0;
          renderConversation(false);
          refreshInbox();
          showPage("conversation");
        }
      } catch (e) {
        console.warn(`[VCMumbleItem/BP] send message failed player=${player.name}: ${e}`);
        composeStatus.setData("\n§cส่งข้อความไม่สำเร็จ กรุณาลองใหม่§r\n");
      }
    };

    const openInbox = () => {
      messageDetailStatus.setData("");
      conversationOlderVisible.setData(false);
      conversationNewerVisible.setData(false);
      refreshInbox();
      showPage("inbox");
    };

    const openMessageAt = (index) => {
      refreshInbox();
      const message = inboxCache[index];
      if (!message || !activeProfile) return;
      selectedMessage = message;

      if (!message.read) {
        const inbox = readPhoneInbox(activeProfile.id);
        const target = inbox.find((entry) => entry.id === message.id);
        if (target) {
          target.read = true;
          try { writePhoneInbox(activeProfile.id, inbox); } catch {}
        }
        selectedMessage.read = true;
      }

      const stamp = formatPhoneMessageTime(message.timestamp);
      const displayName = resolveIncomingMessageName(activeProfile.id, message);
      const displayNumber = message.anonymous ? ANONYMOUS_NUMBER : message.senderNumber;
      messageDetailText.setData(
        displayName
          ? `\nชื่อ: §f${displayName}§r\n\nเบอร์: §b${displayNumber}§r\n\nวันที่: §f${stamp.date}§r\n\nเวลา: §f${stamp.time}§r\n\nข้อความ:\n\n§f${message.body}§r\n`
          : `\nเบอร์: §b${displayNumber}§r\n\nวันที่: §f${stamp.date}§r\n\nเวลา: §f${stamp.time}§r\n\nข้อความ:\n\n§f${message.body}§r\n`
      );
      messageDetailStatus.setData("");
      refreshInbox();
      showPage("messageDetail");
    };

    const replySelectedMessage = () => {
      if (!selectedMessage) return;
      if (selectedMessage.anonymous) {
        messageDetailStatus.setData("\n§eไม่สามารถตอบกลับข้อความที่ไม่ระบุตัวตนได้§r\n");
        return;
      }
      const target = readPhoneProfile(selectedMessage.senderPhoneId) ?? readPhoneProfileByNumber(selectedMessage.senderNumber);
      if (!target) {
        messageDetailStatus.setData("\n§cไม่พบข้อมูลผู้ส่งในระบบ§r\n");
        return;
      }
      const displayName = resolveIncomingMessageName(activeProfile.id, selectedMessage);
      beginCompose(target, displayName);
    };

    const deleteSelectedMessage = () => {
      if (!activeProfile || !selectedMessage) return;
      try {
        const inbox = readPhoneInbox(activeProfile.id).filter((entry) => entry.id !== selectedMessage.id);
        writePhoneInbox(activeProfile.id, inbox);
        selectedMessage = undefined;
        refreshInbox();
        showPage("inbox");
      } catch (e) {
        console.warn(`[VCMumbleItem/BP] delete message failed player=${player.name}: ${e}`);
        messageDetailStatus.setData("\n§cลบข้อความไม่สำเร็จ กรุณาลองใหม่§r\n");
      }
    };

    refreshIdentityText();
    if (activeProfile) {
      refreshContacts();
      refreshInbox();
      routeToCurrentCall();
    }

    const form = new CustomForm(player, "SleepyPhone")
      .header("ตั้งค่าโทรศัพท์ครั้งแรก", { visible: pages.setupName })
      .label("\nกรอกชื่อ IC ที่ต้องการบันทึกไว้กับโทรศัพท์เครื่องนี้\n", { visible: pages.setupName })
      .textField("ชื่อ IC", icNameInput, {
        visible: pages.setupName,
        description: `\nสูงสุด ${PHONE_NAME_MAX_LENGTH} ตัวอักษร\n`,
      })
      .label(setupStatus, { visible: pages.setupName })
      .button("ยืนยันชื่อ IC", showNumberPage, { visible: pages.setupName })

      .header("ลงทะเบียนเบอร์โทร", { visible: pages.setupNumber })
      .label(setupNameText, { visible: pages.setupNumber })
      .label("\nเลือกตั้งเบอร์เอง 4 หลัก หรือให้ระบบสุ่มเบอร์ที่ยังว่างอยู่\n", { visible: pages.setupNumber })
      .textField("เบอร์โทร 4 หลัก", numberInput, {
        visible: pages.setupNumber,
        description: "\nตัวอย่าง 0123 หรือ 4821\n",
      })
      .label(setupStatus, { visible: pages.setupNumber })
      .button("ใช้เบอร์ที่กรอก", submitManualNumber, { visible: pages.setupNumber })
      .button("สุ่มเบอร์", submitRandomNumber, { visible: pages.setupNumber })
      .button("ย้อนกลับ", showNamePage, { visible: pages.setupNumber })

      .label(identityText, { visible: pages.home })
      .divider({ visible: pages.home })
      .header("Application", { visible: pages.home })
      .button("ส่งข้อความ", openSendMethod, { visible: pages.home })
      .button(inboxHomeButtonLabel, openInbox, { visible: pages.home })
      .button("โทร", openCallMethod, { visible: pages.home })
      .button("ตั้งค่า", () => homeStatus.setData("\nApplication ตั้งค่าเตรียมไว้สำหรับพัฒนาต่อ\n"), { visible: pages.home })
      .spacer({ visible: pages.home })
      .header("Favorites", { visible: pages.home })
      .label(favoritesInfo, { visible: pages.home });

    for (let i = 0; i < PHONE_CONTACT_LIMIT; i++) {
      form.button(favoriteButtonLabels[i], () => openFavoriteAt(i), { visible: favoriteButtonVisible[i] });
    }

    form
      .spacer({ visible: pages.home })
      .label(homeStatus, { visible: pages.home })

      .header("ส่งข้อความ", { visible: pages.sendMethod })
      .label("\nเลือกวิธีระบุผู้รับข้อความ\n", { visible: pages.sendMethod })
      .button("ส่งด้วยเบอร์", openDirectNumber, { visible: pages.sendMethod })
      .button("ส่งด้วยรายชื่อ", () => openContacts("sendMethod"), { visible: pages.sendMethod })
      .button("ย้อนกลับ", openHome, { visible: pages.sendMethod })

      .header("ส่งด้วยเบอร์", { visible: pages.sendNumber })
      .label("\nกรอกเบอร์ SleepyPhone ของผู้รับ\n", { visible: pages.sendNumber })
      .textField("เบอร์ 4 หลัก", directNumberInput, {
        visible: pages.sendNumber,
        description: "\nตัวอย่าง 0123 หรือ 4821\n",
      })
      .label(directNumberStatus, { visible: pages.sendNumber })
      .button("ถัดไป", submitDirectNumber, { visible: pages.sendNumber })
      .button("ย้อนกลับ", openSendMethod, { visible: pages.sendNumber })

      .header("รายชื่อ", { visible: pages.contacts })
      .label(contactSummary, { visible: pages.contacts })
      .button("เพิ่มรายชื่อ", openAddContact, { visible: pages.contacts })
      .label(contactEmptyText, { visible: pages.contacts });

    for (let i = 0; i < PHONE_CONTACT_LIMIT; i++) {
      form.button(contactButtonLabels[i], () => openContactAt(i), { visible: contactButtonVisible[i] });
    }

    form
      .button("ย้อนกลับ", backFromContacts, { visible: pages.contacts })

      .header("เพิ่มรายชื่อ", { visible: pages.addContact })
      .label("\nกรอกชื่อที่ต้องการตั้ง หากเว้นว่างจะใช้ชื่อ IC ของเบอร์นั้น\n", { visible: pages.addContact })
      .textField("ชื่อรายชื่อ", addContactNameInput, {
        visible: pages.addContact,
        description: "\nไม่บังคับ\n",
      })
      .textField("เบอร์ 4 หลัก", addContactNumberInput, {
        visible: pages.addContact,
        description: "\nกรอกเบอร์ SleepyPhone ที่ต้องการเพิ่ม\n",
      })
      .label(addContactStatus, { visible: pages.addContact })
      .button("เพิ่มรายชื่อ", submitAddContact, { visible: pages.addContact })
      .button("ย้อนกลับ", openContacts, { visible: pages.addContact })

      .header("ข้อมูลรายชื่อ", { visible: pages.contactDetail })
      .label(contactDetailText, { visible: pages.contactDetail })
      .button("ส่งข้อความ", composeSelectedContact, { visible: pages.contactDetail })
      .button("โทร", callSelectedContact, { visible: pages.contactDetail })
      .button(contactFavoriteActionLabel, toggleSelectedContactFavorite, { visible: pages.contactDetail })
      .button("ลบรายชื่อ", beginDeleteContact, { visible: pages.contactDetail })
      .button("ย้อนกลับ", backFromContactDetail, { visible: pages.contactDetail })
      .label(contactDetailStatus, { visible: pages.contactDetail })

      .header("ลบรายชื่อ", { visible: pages.deleteContact })
      .label(deleteContactText, { visible: pages.deleteContact })
      .button("ยืนยันลบรายชื่อ", confirmDeleteContact, { visible: pages.deleteContact })
      .button("ยกเลิก", () => showPage("contactDetail"), { visible: pages.deleteContact })

      .header("เขียนข้อความ", { visible: pages.compose })
      .label(composeRecipientText, { visible: pages.compose })
      .textField("ข้อความ", composeInput, {
        visible: pages.compose,
        description: `\nสูงสุด ${PHONE_MESSAGE_MAX_LENGTH} ตัวอักษร\n`,
      })
      .toggle("ไม่ระบุตัวตน", anonymousToggle, {
        visible: pages.compose,
        description: `\nเมื่อเปิด ผู้รับจะเห็นชื่อเป็น ${ANONYMOUS_NAME} และเบอร์เป็น ${ANONYMOUS_NUMBER}\n`,
      })
      .label(composeStatus, { visible: pages.compose })
      .button("ส่งข้อความ", sendComposedMessage, { visible: pages.compose })
      .button("ย้อนกลับ", openSendMethod, { visible: pages.compose })

      .header("โทร", { visible: pages.callMethod })
      .label("\nเลือกวิธีระบุผู้รับสาย\n", { visible: pages.callMethod })
      .button("โทรด้วยเบอร์", openCallNumber, { visible: pages.callMethod })
      .button("โทรด้วยรายชื่อ", () => openContacts("callMethod"), { visible: pages.callMethod })
      .button("ย้อนกลับ", openHome, { visible: pages.callMethod })

      .header("โทรด้วยเบอร์", { visible: pages.callNumber })
      .label("\nกรอกเบอร์ SleepyPhone ที่ต้องการโทรหา\n", { visible: pages.callNumber })
      .textField("เบอร์ 4 หลัก", callNumberInput, {
        visible: pages.callNumber,
        description: "\nตัวอย่าง 0123 หรือ 4821\n",
      })
      .label(callNumberStatus, { visible: pages.callNumber })
      .button("ถัดไป", submitCallNumber, { visible: pages.callNumber })
      .button("ย้อนกลับ", openCallMethod, { visible: pages.callNumber })

      .header("เตรียมโทร", { visible: pages.callSetup })
      .label(callSetupText, { visible: pages.callSetup })
      .toggle("ไม่ระบุตัวตน", callAnonymousToggle, {
        visible: pages.callSetup,
        description: `\nเมื่อเปิด ปลายทางจะเห็นชื่อเป็น ${ANONYMOUS_NAME} และเบอร์เป็น ${ANONYMOUS_NUMBER}\n`,
      })
      .label(callSetupStatus, { visible: pages.callSetup })
      .button("โทร", startCall, { visible: pages.callSetup })
      .button("ย้อนกลับ", openCallMethod, { visible: pages.callSetup })

      .header("สายเรียกเข้า", { visible: pages.incomingCall })
      .label(incomingCallText, { visible: pages.incomingCall })
      .label(incomingCallStatus, { visible: pages.incomingCall })
      .button("รับสาย", acceptIncomingCall, { visible: pages.incomingCall })
      .button("ตัดสาย", rejectIncomingCall, { visible: pages.incomingCall })

      .header("กำลังโทร", { visible: pages.outgoingCall })
      .label(outgoingCallText, { visible: pages.outgoingCall })
      .label(outgoingCallStatus, { visible: pages.outgoingCall })
      .button("ยกเลิกการโทร", cancelOutgoingCall, { visible: pages.outgoingCall })

      .header("กำลังคุย", { visible: pages.activeCall })
      .label(activeCallText, { visible: pages.activeCall })
      .button(speakerActionLabel, toggleCallSpeaker, { visible: pages.activeCall })
      .button("วางสาย", hangupActiveCall, { visible: pages.activeCall })
      .label(activeCallStatus, { visible: pages.activeCall })

      .header("กล่องข้อความ", { visible: pages.inbox })
      .label(inboxSummary, { visible: pages.inbox })
      .label(inboxEmptyText, { visible: pages.inbox });

    for (let i = 0; i < PHONE_INBOX_LIMIT; i++) {
      form.button(inboxButtonLabels[i], () => openInboxEntryAt(i), { visible: inboxButtonVisible[i] });
    }

    form
      .button("ย้อนกลับ", openHome, { visible: pages.inbox })

      .header("ข้อความ", { visible: pages.messageDetail })
      .label(messageDetailText, { visible: pages.messageDetail })
      .button("ตอบกลับ", replySelectedMessage, { visible: pages.messageDetail })
      .button("ลบข้อความ", deleteSelectedMessage, { visible: pages.messageDetail })
      .button("ย้อนกลับ", openInbox, { visible: pages.messageDetail })
      .label(messageDetailStatus, { visible: pages.messageDetail })

      .header("แชท", { visible: pages.conversation })
      .label(conversationTitleText, { visible: pages.conversation })
      .label(conversationHistoryText, { visible: pages.conversation })
      .button("ข้อความเก่ากว่า", openOlderConversationMessages, { visible: conversationOlderVisible })
      .button("ข้อความใหม่กว่า", openNewerConversationMessages, { visible: conversationNewerVisible })
      .textField("ข้อความ", conversationInput, {
        visible: pages.conversation,
        description: `\nสูงสุด ${PHONE_MESSAGE_MAX_LENGTH} ตัวอักษร\n`,
      })
      .label(conversationStatus, { visible: pages.conversation })
      .button("ส่งข้อความ", sendConversationMessage, { visible: pages.conversation })
      .button("ย้อนกลับ", openInbox, { visible: pages.conversation });

    phoneRefreshId = system.runInterval(() => {
      try {
        if (!activeProfile) return;
        const call = refreshCallUi();
        if (
          currentPhonePage === "conversation" &&
          selectedConversationId &&
          system.currentTick - lastConversationRefreshTick >= 20
        ) {
          lastConversationRefreshTick = system.currentTick;
          renderConversation(true);
          refreshInbox();
        }
        if (currentPhonePage === "incomingCall" || currentPhonePage === "outgoingCall" || currentPhonePage === "activeCall") {
          if (!call) {
            homeStatus.setData("\nสายสิ้นสุดแล้ว\n");
            openHome();
            return;
          }
          if (call.status === "active" && currentPhonePage !== "activeCall") {
            activeCallStatus.setData("");
            showPage("activeCall");
          } else if (call.status === "ringing" && call.calleePhoneId === activeProfile.id && currentPhonePage !== "incomingCall") {
            showPage("incomingCall");
          } else if (call.status === "ringing" && call.callerPhoneId === activeProfile.id && currentPhonePage !== "outgoingCall") {
            showPage("outgoingCall");
          }
        }
      } catch {}
    }, 10);

    await form.show();
  } catch (e) {
    console.warn(`[VCMumbleItem/BP] phone DDUI failed player=${playerName}: ${e}`);
  } finally {
    if (phoneRefreshId !== undefined) system.clearRun(phoneRefreshId);
    openPhonePlayers.delete(playerId);
  }
}

function handlePhoneUse(player) {
  if (!player) return;
  system.run(() => showPhone(player));
}

function isOperator(player) {
  try {
    return player.playerPermissionLevel === PlayerPermissionLevel.Operator;
  } catch {
    return false;
  }
}

function readTaggedNumber(player, prefix, fallback) {
  try {
    for (const tag of player.getTags()) {
      if (!tag.startsWith(prefix)) continue;
      const value = Number.parseInt(tag.substring(prefix.length), 10);
      if (Number.isFinite(value) && value >= 1) return value;
    }
  } catch {}
  return fallback;
}

function hasTagPrefix(player, prefix) {
  try {
    for (const tag of player.getTags()) {
      if (tag.startsWith(prefix)) return true;
    }
  } catch {}
  return false;
}

function serverVoiceRangeSnapshot(player) {
  const available = hasTagPrefix(player, RANGE_VALUE_PREFIX);
  const value = readTaggedNumber(player, RANGE_VALUE_PREFIX, 0);
  const maximum = readTaggedNumber(player, RANGE_MAX_PREFIX, 0);
  return { available: available && value >= 1, value, maximum };
}

function currentVoiceRange(player) {
  const serverValue = readTaggedNumber(player, RANGE_VALUE_PREFIX, 0);
  if (serverValue >= 1) {
    if (player.getDynamicProperty(PROP_VOICE_RANGE) !== serverValue) {
      player.setDynamicProperty(PROP_VOICE_RANGE, serverValue);
    }
    return serverValue;
  }

  const stored = Number(player.getDynamicProperty(PROP_VOICE_RANGE));
  if (Number.isFinite(stored) && stored >= 1) return Math.floor(stored);

  const legacy = Number(player.getDynamicProperty(LEGACY_PROP_VOICE_RANGE));
  if (Number.isFinite(legacy) && legacy >= 1) return Math.floor(legacy);

  return DEFAULT_VOICE_RANGE;
}

function currentMaxRange(player) {
  const serverMaximum = Math.max(
    1,
    readTaggedNumber(player, RANGE_MAX_PREFIX, DEFAULT_MAX_RANGE)
  );
  return isOperator(player)
    ? serverMaximum
    : Math.min(DEFAULT_MAX_RANGE, serverMaximum);
}

function clearTagsByPrefix(player, prefix) {
  try {
    for (const tag of player.getTags()) {
      if (!tag.startsWith(prefix)) continue;
      try {
        player.removeTag(tag);
      } catch {}
    }
  } catch {}
}

function cleanupLegacyVoiceCraftBridgeTags(player) {
  const prefixes = [
    "voicecraft.vr.",
    "voicecraft.bind.",
    "voicecraft.mic.",
  ];
  for (const prefix of prefixes) clearTagsByPrefix(player, prefix);
}

function nextRangeRequestId() {
  rangeRequestSequence = (rangeRequestSequence + 1) % 1000000;
  return `r${system.currentTick}_${rangeRequestSequence}`;
}

function syncVoiceRangeFromServer(player) {
  const serverValue = readTaggedNumber(player, RANGE_VALUE_PREFIX, 0);
  if (serverValue >= 1 && player.getDynamicProperty(PROP_VOICE_RANGE) !== serverValue) {
    player.setDynamicProperty(PROP_VOICE_RANGE, serverValue);
  }
}

function consumeVoiceRangeAck(player, requestId) {
  if (!requestId) return undefined;
  const prefix = RANGE_ACK_PREFIX + requestId + ".";

  try {
    for (const tag of player.getTags()) {
      if (!tag.startsWith(prefix)) continue;

      const payload = tag.slice(prefix.length);
      const separator = payload.indexOf(".");
      const status = separator >= 0 ? payload.slice(0, separator) : "";
      const rawValue = separator >= 0 ? payload.slice(separator + 1) : "";
      const value = Number.parseInt(rawValue, 10);

      try {
        player.removeTag(tag);
      } catch {}

      if (!Number.isFinite(value) || value < 1) {
        return { status: "error", value: 0 };
      }
      return { status, value };
    }
  } catch {}

  return undefined;
}

function requestVoiceRangeSync(player) {
  if (globalRangePending.has(player.id)) return "";
  const requestId = nextRangeRequestId();
  clearTagsByPrefix(player, RANGE_ACK_PREFIX);
  clearTagsByPrefix(player, RANGE_SYNC_PREFIX);

  try {
    player.addTag(RANGE_SYNC_PREFIX + requestId);
    return requestId;
  } catch (e) {
    console.warn(
      `[VCMumbleItem/BP] voice range sync request failed player=${player.name}: ${e}`
    );
    return "";
  }
}

function requestVoiceRange(player, value) {
  if (globalRangePending.has(player.id) || voiceRangeCooldownTicks(player) > 0) {
    return "";
  }
  value = Math.floor(Number(value));
  if (!Number.isFinite(value) || value < 1 || value > 30000000) {
    player.sendMessage("§c[VC Mumble] ระยะเสียงต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป§r");
    return "";
  }

  const maximum = currentMaxRange(player);
  if (!isOperator(player) && value > maximum) {
    player.sendMessage(
      `§c[VC Mumble] ระยะสูงสุดที่เซิร์ฟเวอร์กำหนดคือ ${maximum} บล็อก§r`
    );
    return "";
  }

  const requestId = nextRangeRequestId();
  clearTagsByPrefix(player, RANGE_REQUEST_PREFIX);
  clearTagsByPrefix(player, RANGE_ACK_PREFIX);
  clearTagsByPrefix(player, RANGE_SYNC_PREFIX);

  try {
    player.addTag(`${RANGE_REQUEST_PREFIX}${requestId}.${value}`);
    globalRangePending.set(player.id, {
      id: requestId,
      value,
      deadlineTick: system.currentTick + RANGE_REQUEST_TIMEOUT_TICKS,
    });
    console.warn(`[VCMumbleItem/BP] RANGE_REQUEST player=${player.name} value=${value} id=${requestId}`);
    return requestId;
  } catch (e) {
    console.warn(
      `[VCMumbleItem/BP] voice range request failed player=${player.name}: ${e}`
    );
    return "";
  }
}



function pollGlobalRangeRequests() {
  for (const [playerId, result] of globalRangeResults) {
    if (system.currentTick - result.tick > 20 * 30) globalRangeResults.delete(playerId);
  }
  if (globalRangePending.size === 0) return;
  const online = new Map(world.getAllPlayers().map((player) => [player.id, player]));
  for (const [playerId, pending] of globalRangePending) {
    const player = online.get(playerId);
    if (!player) {
      if (system.currentTick >= pending.deadlineTick) globalRangePending.delete(playerId);
      continue;
    }
    const ack = consumeVoiceRangeAck(player, pending.id);
    const snapshot = serverVoiceRangeSnapshot(player);
    const implicitAck = !ack && snapshot.available && snapshot.value === pending.value;
    if (ack || implicitAck) {
      const accepted = ack?.value ?? snapshot.value;
      const success = accepted === pending.value && (implicitAck || ack?.status === "ok");
      if (accepted >= 1 && player.getDynamicProperty(PROP_VOICE_RANGE) !== accepted) {
        player.setDynamicProperty(PROP_VOICE_RANGE, accepted);
      }
      if (success) startVoiceRangeCooldown(player);
      else rangeChangeCooldownUntil.set(player.id, system.currentTick + RANGE_RETRY_COOLDOWN_TICKS);
      globalRangeResults.set(playerId, {
        id: pending.id, requested: pending.value, value: accepted,
        status: success ? "ok" : "rejected", tick: system.currentTick,
      });
      globalRangePending.delete(playerId);
      console.warn(`[VCMumbleItem/BP] RANGE_${success ? "ACK" : "REJECT"} player=${player.name} requested=${pending.value} actual=${accepted} id=${pending.id}`);
      try { player.sendMessage(success ? `[ Sleepy Voice Chat ] เปลี่ยนระยะสำเร็จ ${accepted} บล็อก` : `[ Sleepy Voice Chat ] เปลี่ยนระยะไม่สำเร็จ (ปัจจุบัน ${accepted} บล็อก)`); } catch {}
    } else if (system.currentTick >= pending.deadlineTick) {
      // Removing a stale tag is not a retry. Never flood the Endstone tick loop.
      clearTagsByPrefix(player, RANGE_REQUEST_PREFIX);
      rangeChangeCooldownUntil.set(playerId, system.currentTick + RANGE_RETRY_COOLDOWN_TICKS);
      globalRangeResults.set(playerId, {
        id: pending.id, requested: pending.value,
        value: snapshot.available ? snapshot.value : 0,
        status: "timeout", tick: system.currentTick,
      });
      globalRangePending.delete(playerId);
      console.warn(`[VCMumbleItem/BP] RANGE_TIMEOUT player=${player.name} requested=${pending.value} id=${pending.id}`);
      try { player.sendMessage("[ Sleepy Voice Chat ] ไม่มี ACK จากเซิร์ฟเวอร์ กรุณาลองใหม่ภายหลัง"); } catch {}
    }
  }
}

function readTaggedLevel(player, prefix, fallback) {
  try {
    for (const tag of player.getTags()) {
      if (!tag.startsWith(prefix)) continue;
      const value = Number.parseInt(tag.substring(prefix.length), 10);
      if (Number.isFinite(value) && value >= 0 && value <= 4) return value;
    }
  } catch {}
  return fallback;
}

function attenuationLabel(level) {
  switch (Math.max(0, Math.min(4, Number(level) || 0))) {
    case 0:
      return "ปิดการลดเสียง";
    case 1:
      return "เบา";
    case 3:
      return "แรง";
    case 4:
      return "แรงมาก";
    default:
      return "ปกติ";
  }
}

function currentAttenuationLevel(player) {
  return readTaggedLevel(player, ATTN_VALUE_PREFIX, 2);
}

function serverAttenuationSnapshot(player) {
  const available = hasTagPrefix(player, ATTN_VALUE_PREFIX);
  const value = readTaggedLevel(player, ATTN_VALUE_PREFIX, -1);
  return { available: available && value >= 0 && value <= 4, value };
}

function nextAttenuationRequestId() {
  attenuationRequestSequence = (attenuationRequestSequence + 1) % 1000000;
  return `a${system.currentTick}_${attenuationRequestSequence}`;
}

function consumeAttenuationAck(player, requestId) {
  if (!requestId) return undefined;
  const prefix = ATTN_ACK_PREFIX + requestId + ".";

  try {
    for (const tag of player.getTags()) {
      if (!tag.startsWith(prefix)) continue;

      const payload = tag.slice(prefix.length);
      const separator = payload.indexOf(".");
      const status = separator >= 0 ? payload.slice(0, separator) : "";
      const rawValue = separator >= 0 ? payload.slice(separator + 1) : "";
      const value = Number.parseInt(rawValue, 10);

      try {
        player.removeTag(tag);
      } catch {}

      if (!Number.isFinite(value) || value < 0 || value > 4) {
        return { status: "error", value: 2 };
      }
      return { status, value };
    }
  } catch {}

  return undefined;
}

function requestAttenuationSync(player) {
  const requestId = nextAttenuationRequestId();
  clearTagsByPrefix(player, ATTN_ACK_PREFIX);
  clearTagsByPrefix(player, ATTN_SYNC_PREFIX);

  try {
    player.addTag(ATTN_SYNC_PREFIX + requestId);
    return requestId;
  } catch (e) {
    console.warn(
      `[VCMumbleItem/BP] attenuation sync request failed player=${player.name}: ${e}`
    );
    return "";
  }
}

function requestAttenuation(player, level) {
  level = Math.floor(Number(level));
  if (!Number.isFinite(level) || level < 0 || level > 4) {
    player.sendMessage("§c[VC Mumble] ระดับเสียงตามระยะต้องอยู่ระหว่าง 0-4§r");
    return "";
  }

  const requestId = nextAttenuationRequestId();
  clearTagsByPrefix(player, ATTN_REQUEST_PREFIX);
  clearTagsByPrefix(player, ATTN_ACK_PREFIX);
  clearTagsByPrefix(player, ATTN_SYNC_PREFIX);

  try {
    player.addTag(`${ATTN_REQUEST_PREFIX}${requestId}.${level}`);
    return requestId;
  } catch (e) {
    console.warn(
      `[VCMumbleItem/BP] attenuation request failed player=${player.name}: ${e}`
    );
    return "";
  }
}

function modeUiLabel(mode) {
  return mode === MODE_TOGGLE ? "Toggle" : "Hold-to-Talk";
}

function applyMicModeFromUi(
  player,
  newMode,
  statusText,
  modeText,
  holdDisabled,
  toggleDisabled
) {
  setMode(player, newMode);

  if (newMode === MODE_TOGGLE) {
    const mainMic = isMicId(getMainId(player));
    const offMic = isMicId(getOffId(player));
    setLatch(player, !!(mainMic || offMic));
  } else {
    setLatch(player, false);
  }

  states.delete(player.id);
  system.run(() => {
    try {
      evaluate(player);
      reassertMicFlags(player);
      const refreshed = stateFor(player);
      statusText.setData(
        `สถานะไมค์: ${refreshed.effective ? "§aON" : "§cOFF"}§r\n`
      );
      modeText.setData(`โหมด: §e${modeUiLabel(refreshed.mode)}§r\n`);
      holdDisabled.setData(refreshed.mode === MODE_HOLD);
      toggleDisabled.setData(refreshed.mode === MODE_TOGGLE);
    } catch (e) {
      console.warn(`[VCMumbleItem/BP] mode update failed player=${player.name}: ${e}`);
    }
  });
}

function renderVoiceRangePreview(player, radius) {
  let center;
  try {
    center = player.location;
  } catch {
    return false;
  }

  // Player.spawnParticle is private to this player. Re-render around the current
  // location so the 360-degree ring follows them instead of remaining on the ground.
  for (let i = 0; i < SAFE_PREVIEW_POINTS; i++) {
    const angle = 2 * Math.PI * i / SAFE_PREVIEW_POINTS;
    const point = {
      x: center.x + radius * Math.cos(angle),
      y: center.y + SAFE_PREVIEW_WAIST_OFFSET,
      z: center.z + radius * Math.sin(angle),
    };
    try {
      player.spawnParticle(SAFE_PREVIEW_PARTICLE, point);
    } catch {}
  }
  return true;
}

function showVoiceRangePreview(player, rawRadius, source = "slider") {
  if (!SAFE_PREVIEW_ENABLED) return;
  const radius = Math.max(
    1,
    Math.min(currentMaxRange(player), Math.floor(Number(rawRadius) || 1))
  );

  activeRangePreviews.set(player.id, {
    player,
    radius,
    expiresAt: system.currentTick + SAFE_PREVIEW_DURATION_TICKS,
  });
  renderVoiceRangePreview(player, radius);
  console.info(
    `[SleepyVoice] RANGE_PREVIEW player=${player.name} value=${radius} source=${source} ttl=10s y=waist`
  );
}

system.runInterval(() => {
  if (!SAFE_PREVIEW_ENABLED || activeRangePreviews.size === 0) return;

  for (const [playerId, preview] of activeRangePreviews) {
    if (system.currentTick >= preview.expiresAt) {
      activeRangePreviews.delete(playerId);
      continue;
    }
    if (!renderVoiceRangePreview(preview.player, preview.radius)) {
      activeRangePreviews.delete(playerId);
    }
  }
}, SAFE_PREVIEW_RENDER_INTERVAL_TICKS);

function startDeferredRange(player, value, form) {
  try { form.close(); } catch {}
  system.runTimeout(() => {
    try {
      const id = requestVoiceRange(player, value);
      player.sendMessage(id ? "[ Sleepy Voice Chat ] กำลังเปลี่ยนระยะเสียง" : "[ Sleepy Voice Chat ] รอคูลดาวน์ก่อน");
    } catch (e) { console.warn("[SleepyVoice] RANGE_SEND_ERROR " + e); }
  }, 2);
}
const openSettingsPlayers = new Set();
const openSettingsForms = new Map();

async function showSettings(player) {
  if (openSettingsPlayers.has(player.id)) {
    player.sendMessage("§e[VC Mumble] หน้าตั้งค่า Mic เปิดอยู่แล้ว§r");
    return;
  }

  openSettingsPlayers.add(player.id);
  let refreshId;
  let previewPollId;

  try {
    ensureMic(player);
    evaluate(player);
    syncVoiceRangeFromServer(player);

    const initial = stateFor(player);
    const initialRange = currentVoiceRange(player);
    const initialMax = Math.max(1, currentMaxRange(player));
    const initialAttenuation = currentAttenuationLevel(player);

    const statusText = new ObservableString(
      `\nสถานะไมค์: ${initial.effective ? "§aON" : "§cOFF"}§r\n`
    );
    const modeText = new ObservableString(`โหมด: §e${modeUiLabel(initial.mode)}§r\n`);
    const rangeText = new ObservableString(
      `ระยะเสียงปัจจุบัน: §b${initialRange} บล็อก§r\n`
    );
    const rangeConfirmText = new ObservableString(
      "สถานะ Endstone: §aเลือกค่าระยะแล้วกดใช้ระยะ หน้าจอจะปิดก่อนส่งคำขอ§r\n"
    );
    const attenuationText = new ObservableString(
      `เสียงตามระยะ: §d${attenuationLabel(initialAttenuation)} (ระดับ ${initialAttenuation})§r\n`
    );
    const attenuationConfirmText = new ObservableString(
      "สถานะ Distance Volume: §eกำลังซิงก์...§r\n"
    );
    const offhandText = new ObservableString(
      isMicId(getOffId(player))
        ? "มือซ้าย: §aมี Mic — ใช้สถานะ ON/OFF ตามโหมด§r\n"
        : "มือซ้าย: §7ไม่มี Mic§r\n"
    );
    const serverLimitText = new ObservableString(
      isOperator(player)
        ? "สิทธิ์: §dOperator — Endstone อนุญาตสูงสุด 1000 บล็อก§r\n"
        : `ระยะสูงสุด: §b${initialMax} บล็อก§r\n`
    );

    const holdDisabled = new ObservableBoolean(initial.mode === MODE_HOLD);
    const toggleDisabled = new ObservableBoolean(initial.mode === MODE_TOGGLE);
    const advancedVisible = new ObservableBoolean(false, { clientWritable: true });
    const rangeSlider = new ObservableNumber(Math.min(initialRange, initialMax), {
      clientWritable: true,
    });
    const sliderMax = new ObservableNumber(initialMax);
    const customRange = new ObservableString(String(initialRange), {
      clientWritable: true,
    });
    const initialCooldownSeconds = voiceRangeCooldownSeconds(player);
    const cooldownStatusText = new ObservableString(
      initialCooldownSeconds > 0
        ? `คูลดาวน์เปลี่ยนระยะ: §e${initialCooldownSeconds} วิ§r\n`
        : "คูลดาวน์เปลี่ยนระยะ: §aพร้อมเปลี่ยนได้§r\n"
    );
    const rangeControlsVisible = new ObservableBoolean(
      initialCooldownSeconds <= 0 && !globalRangePending.has(player.id)
    );
    let lastSliderRange = Math.floor(rangeSlider.getData());
    let lastPreviewSliderRange = lastSliderRange;
    let sliderCandidateRange = null;
    let sliderSettleDueTick = 0;
    let queuedSliderRange = null;
    let sliderCommitDueTick = 0;

    let confirmedRange = initialRange;
    let pendingRange = null;
    let pendingRequestId = "";
    let pendingChecks = 0;
    let syncRequestId = "";
    let syncChecks = 0;
    let nextPeriodicSyncTick = system.currentTick + 100;

    let confirmedAttenuation = initialAttenuation;
    let pendingAttenuation = null;
    let pendingAttenuationRequestId = "";
    let pendingAttenuationChecks = 0;
    // Avoid unrelated tag traffic while the player is adjusting Voice Range.
    // The current form has no active attenuation control.
    let attenuationSyncRequestId = "";
    let attenuationSyncChecks = 0;
    let nextAttenuationSyncTick = system.currentTick + 100;

    const submitRange = (rawValue) => {
      const value = Number.parseInt(String(rawValue ?? ""), 10);
      if (!Number.isFinite(value)) {
        rangeConfirmText.setData("สถานะ Endstone: §cกรุณาระบุระยะเป็นตัวเลข§r\n");
        return;
      }

      const cooldownTicks = voiceRangeCooldownTicks(player);
      if (pendingRequestId || globalRangePending.has(player.id)) {
        setObservableIfChanged(rangeConfirmText, "สถานะ Endstone: §eกำลังรอ ACK จากคำขอก่อนหน้า§r\n");
        return;
      }
      if (value === confirmedRange) {
        setObservableIfChanged(rangeConfirmText, `สถานะ Endstone: §aใช้อยู่แล้ว — ${confirmedRange} บล็อก§r\n`);
        return;
      }
      if (cooldownTicks > 0) {
        const cooldownSeconds = Math.ceil(cooldownTicks / 20);
        queuedSliderRange = null;
        sliderCommitDueTick = 0;
        sliderCandidateRange = null;
        sliderSettleDueTick = 0;
        setObservableIfChanged(
          rangeConfirmText,
          `สถานะ Endstone: §eคูลดาวน์ ${cooldownSeconds} วิ • รอให้คูลดาวน์เสร็จก่อน§r\n`
        );
        return;
      }

      return startDeferredRange(player, value, form);
    };

    const submitQuickRange = (rawValue) => {
      const value = Math.floor(Number(rawValue));
      if (!Number.isFinite(value) || value < 1) return;
      return submitRange(value);
    };

    const submitAttenuation = (rawLevel) => {
      const level = Number.parseInt(String(rawLevel ?? ""), 10);
      if (!Number.isFinite(level) || level < 0 || level > 4) {
        attenuationConfirmText.setData(
          "สถานะ Distance Volume: §cระดับต้องอยู่ระหว่าง 0-4§r\n"
        );
        return;
      }

      const requestId = requestAttenuation(player, level);
      if (!requestId) {
        attenuationConfirmText.setData(
          "สถานะ Distance Volume: §cส่งคำขอไม่สำเร็จ§r\n"
        );
        return;
      }

      pendingAttenuation = level;
      pendingAttenuationRequestId = requestId;
      pendingAttenuationChecks = 0;
      attenuationSyncRequestId = "";
      attenuationSyncChecks = 0;
      attenuationConfirmText.setData(
        `สถานะ Distance Volume: §eกำลังรอยืนยัน ${attenuationLabel(level)}...§r\n`
      );
    };

    const mainPageVisible = new ObservableBoolean(true);
    const settingsPageVisible = new ObservableBoolean(false);
    const syncRangeControlsVisibility = () => {
      rangeControlsVisible.setData(
        mainPageVisible.getData() === true &&
        voiceRangeCooldownTicks(player) <= 0 && !globalRangePending.has(player.id)
      );
    };
    const showMainPage = () => {
      mainPageVisible.setData(true);
      settingsPageVisible.setData(false);
      syncRangeControlsVisibility();
    };
    const showSettingsPage = () => {
      mainPageVisible.setData(false);
      settingsPageVisible.setData(true);
      rangeControlsVisible.setData(false);
    };

    const form = new CustomForm(player, "VC Mumble • Mic Settings")
      .header("สถานะ", { visible: mainPageVisible })
      .label(modeText, { visible: mainPageVisible })
      .label(rangeText, { visible: mainPageVisible })
      .label(cooldownStatusText, { visible: mainPageVisible })
      .label(serverLimitText, { visible: mainPageVisible })
      .spacer({ visible: mainPageVisible })
      .divider({ visible: mainPageVisible })
      .header("Voice Range", { visible: mainPageVisible })
      .button("10 บล็อก", () => submitQuickRange(10), {
        visible: rangeControlsVisible,
      })
      .button("20 บล็อก", () => submitQuickRange(20), {
        visible: rangeControlsVisible,
      })
      .button("30 บล็อก", () => submitQuickRange(30), {
        visible: rangeControlsVisible,
      })
      .spacer({ visible: rangeControlsVisible })
      .slider("ระยะเสียงแบบ Slider", rangeSlider, 1, sliderMax, {
        step: 1,
        visible: rangeControlsVisible,
        description:
          "เลือกค่าแล้วกดใช้ระยะจาก Slider • ไม่มีการส่งคำขอระหว่างลาก",
      })
      .button("ใช้ระยะจาก Slider", () => submitRange(rangeSlider.getData()), {
        visible: rangeControlsVisible,
      })
      .spacer({ visible: mainPageVisible })
      .button("ตั้งค่า", showSettingsPage, {
        visible: mainPageVisible,
      })
      .divider({ visible: settingsPageVisible })
      .header("ตั้งค่า", { visible: settingsPageVisible })
      .header("Mic Mode", { visible: settingsPageVisible })
      .label("Hold-to-Talk\nถือ Mic = เปิดเสียง\nเลิกถือ = ปิดเสียง\n", {
        visible: settingsPageVisible,
      })
      .button(
        "Hold-to-Talk",
        () =>
          applyMicModeFromUi(
            player,
            MODE_HOLD,
            statusText,
            modeText,
            holdDisabled,
            toggleDisabled
          ),
        { disabled: holdDisabled, visible: settingsPageVisible }
      )
      .spacer({ visible: settingsPageVisible })
      .label("Toggle\nหยิบ Mic ขึ้นมาหนึ่งครั้งเพื่อสลับ ON/OFF\n", {
        visible: settingsPageVisible,
      })
      .button(
        "Toggle",
        () =>
          applyMicModeFromUi(
            player,
            MODE_TOGGLE,
            statusText,
            modeText,
            holdDisabled,
            toggleDisabled
          ),
        { disabled: toggleDisabled, visible: settingsPageVisible }
      )
      .spacer({ visible: settingsPageVisible })
      .divider({ visible: settingsPageVisible })
      .header("Reset", { visible: settingsPageVisible })
      .label("คืน Mic Mode เป็น Toggle\nVoice Range = 30 บล็อก\n", {
        visible: settingsPageVisible,
      })
      .button("คืนค่าเริ่มต้น", () => {
        if (globalRangePending.has(player.id) || voiceRangeCooldownTicks(player) > 0) {
          setObservableIfChanged(rangeConfirmText, "สถานะ Endstone: §eรอให้คูลดาวน์เสร็จก่อนรีเซ็ตระยะ§r\n");
          return;
        }
        const resetRange = isOperator(player) ? 30 : Math.min(30, sliderMax.getData());
        customRange.setData(String(resetRange));
        lastSliderRange = Math.min(resetRange, sliderMax.getData());
        rangeSlider.setData(lastSliderRange);
        applyMicModeFromUi(
          player,
          MODE_TOGGLE,
          statusText,
          modeText,
          holdDisabled,
          toggleDisabled
        );
        submitRange(resetRange);
      }, { visible: settingsPageVisible })
      .spacer({ visible: settingsPageVisible })
      .button("กลับหน้าหลัก", showMainPage, {
        visible: settingsPageVisible,
      })
      .closeButton();

    openSettingsForms.set(player.id, form);

    // Read-only slider polling for the self-only preview. This intentionally
    // performs no Observable writes and no Endstone/tag requests while dragging.
    previewPollId = system.runInterval(() => {
      try {
        if (!SAFE_PREVIEW_ENABLED) return;
        if (mainPageVisible.getData() !== true) return;
        if (rangeControlsVisible.getData() !== true) return;
        if (globalRangePending.has(player.id)) return;

        const nextMax = Math.max(1, currentMaxRange(player));
        const sliderValue = Math.max(
          1,
          Math.min(Math.floor(Number(rangeSlider.getData()) || 1), nextMax)
        );
        if (sliderValue === lastPreviewSliderRange) return;

        lastPreviewSliderRange = sliderValue;
        showVoiceRangePreview(player, sliderValue, "slider");
      } catch (e) {
        console.warn(
          `[VCMumbleItem/BP] range preview poll failed player=${player.name}: ${e}`
        );
      }
    }, SAFE_PREVIEW_POLL_TICKS);

    refreshId = system.runInterval(() => {
      try {
        // Native DDUI controls (especially the slider/visibility tree) must
        // remain immutable while the main Voice Range page is interactive.
        // Form.close() happens before a range request is sent.
        if (mainPageVisible.getData() === true &&
            rangeControlsVisible.getData() === true) return;
        const refreshed = stateFor(player);
        const nextMax = Math.max(1, currentMaxRange(player));

        setObservableIfChanged(
          modeText,
          `โหมด: §e${modeUiLabel(refreshed.mode)}§r\n`
        );
        setObservableIfChanged(
          rangeText,
          `ระยะเสียงปัจจุบัน: §b${confirmedRange} บล็อก§r\n`
        );
        const cooldownSeconds = voiceRangeCooldownSeconds(player);
        setObservableIfChanged(
          cooldownStatusText,
          cooldownSeconds > 0
            ? `คูลดาวน์เปลี่ยนระยะ: §e${cooldownSeconds} วิ§r\n`
            : "คูลดาวน์เปลี่ยนระยะ: §aพร้อมเปลี่ยนได้§r\n"
        );
        setObservableIfChanged(
          rangeControlsVisible,
          mainPageVisible.getData() === true && cooldownSeconds <= 0 &&
          !pendingRequestId && !globalRangePending.has(player.id)
        );
        setObservableIfChanged(
          serverLimitText,
          isOperator(player)
            ? `สิทธิ์: §dOperator — ระยะสูงสุด ${nextMax} บล็อก§r\n`
            : `ระยะสูงสุด: §b${nextMax} บล็อก§r\n`
        );
        setObservableIfChanged(holdDisabled, refreshed.mode === MODE_HOLD);
        setObservableIfChanged(toggleDisabled, refreshed.mode === MODE_TOGGLE);

        setObservableIfChanged(sliderMax, nextMax);
        if (rangeSlider.getData() > nextMax && !isOperator(player)) {
          lastSliderRange = nextMax;
          rangeSlider.setData(nextMax);
        }

        if (false && cooldownSeconds <= 0 && !pendingRequestId && !globalRangePending.has(player.id)) {
          const sliderValue = Math.max(
            1,
            Math.min(Math.floor(rangeSlider.getData()), nextMax)
          );
          if (sliderValue !== lastSliderRange) {
            // While the finger is moving, only remember the newest value.
            // No particle preview, Endstone request, tag ACK, or DDUI status write
            // happens here. The value is processed once after the slider settles.
            lastSliderRange = sliderValue;
            sliderCandidateRange = sliderValue;
            sliderSettleDueTick =
              system.currentTick + VOICE_RANGE_SLIDER_SETTLE_TICKS;
          }

          if (
            sliderCandidateRange !== null &&
            system.currentTick >= sliderSettleDueTick
          ) {
            const settledValue = sliderCandidateRange;
            sliderCandidateRange = null;
            // No native particles during slider changes. Preview after ACK only.
            if (!pendingRequestId && settledValue === confirmedRange) {
              queuedSliderRange = null;
              setObservableIfChanged(
                rangeConfirmText,
                `สถานะ Endstone: §aใช้อยู่แล้ว — ${confirmedRange} บล็อก§r\n`
              );
            } else {
              queuedSliderRange = settledValue;
              sliderCommitDueTick = system.currentTick;
            }
          }

          if (
            queuedSliderRange !== null &&
            !pendingRequestId &&
            system.currentTick >= sliderCommitDueTick
          ) {
            const valueToCommit = queuedSliderRange;
            queuedSliderRange = null;
            submitRange(valueToCommit);
          }
        } else {
          sliderCandidateRange = null;
          sliderSettleDueTick = 0;
          queuedSliderRange = null;
          sliderCommitDueTick = 0;
        }

        if (pendingRequestId) {
          const result = globalRangeResults.get(player.id);
          if (result && result.id === pendingRequestId) {
            globalRangeResults.delete(player.id);
            if (result.value >= 1) {
              confirmedRange = result.value;
              setObservableIfChanged(customRange, String(confirmedRange));
              if (confirmedRange <= nextMax) {
                lastSliderRange = confirmedRange;
                setObservableIfChanged(rangeSlider, confirmedRange);
              }
            }
            if (result.status === "ok") {
              setObservableIfChanged(
                rangeConfirmText,
                `สถานะ Endstone: §aยืนยันแล้ว — ${confirmedRange} บล็อก • คูลดาวน์ 30 วิ§r\n`
              );
              system.runTimeout(() => showVoiceRangePreview(player, confirmedRange, "ack"), 5);
            } else {
              setObservableIfChanged(
                rangeConfirmText,
                result.status === "timeout"
                  ? "สถานะ Endstone: §cหมดเวลารอ ACK • หยุดส่งคำขอแล้ว โปรดลองอีกครั้งภายหลัง§r\n"
                  : `สถานะ Endstone: §cไม่รับค่าที่ขอ — ใช้ ${confirmedRange} บล็อก§r\n`
              );
            }
            pendingRange = null;
            pendingRequestId = "";
            pendingChecks = 0;
            nextPeriodicSyncTick = system.currentTick + 100;
          }
        } else {
          if (false && !syncRequestId && system.currentTick >= nextPeriodicSyncTick) {
            syncRequestId = requestVoiceRangeSync(player);
            syncChecks = 0;
            nextPeriodicSyncTick = system.currentTick + 100;
          }

          if (syncRequestId) {
            const syncAck = consumeVoiceRangeAck(player, syncRequestId);
            const syncSnapshot = serverVoiceRangeSnapshot(player);
            if (syncAck || syncSnapshot.available) {
              const syncValue = syncAck?.value ?? syncSnapshot.value;
              if (syncValue >= 1) {
                confirmedRange = syncValue;
                if (player.getDynamicProperty(PROP_VOICE_RANGE) !== syncValue) {
                  player.setDynamicProperty(PROP_VOICE_RANGE, syncValue);
                }
                setObservableIfChanged(customRange, String(confirmedRange));
                if (
                  queuedSliderRange === null &&
                  confirmedRange <= nextMax
                ) {
                  lastSliderRange = confirmedRange;
                  rangeSlider.setData(confirmedRange);
                }
              }
              rangeConfirmText.setData(
                `สถานะ Endstone: §aเชื่อมต่อแล้ว — ${confirmedRange} บล็อก§r\n`
              );
              syncRequestId = "";
              syncChecks = 0;
              nextPeriodicSyncTick = system.currentTick + 100;
            } else {
              syncChecks++;
              if (syncChecks >= 40) {
                rangeConfirmText.setData(
                  "สถานะ Endstone: §cไม่พบ v0.3.0 range contract\n\nตรวจสอบ/อัปเดต Endstone plugin§r\n"
                );
                syncRequestId = "";
                syncChecks = 0;
                nextPeriodicSyncTick = system.currentTick + 100;
              }
            }
          }
        }

        if (pendingAttenuationRequestId) {
          const ack = consumeAttenuationAck(player, pendingAttenuationRequestId);
          const snapshot = serverAttenuationSnapshot(player);
          const implicitAck =
            !ack &&
            snapshot.available &&
            pendingAttenuation !== null &&
            snapshot.value === pendingAttenuation;

          if (ack || implicitAck) {
            const acceptedLevel = ack?.value ?? snapshot.value;
            if (acceptedLevel >= 0 && acceptedLevel <= 4) {
              confirmedAttenuation = acceptedLevel;
            }

            if (
              implicitAck ||
              (ack?.status === "ok" && acceptedLevel === pendingAttenuation)
            ) {
              attenuationConfirmText.setData(
                `สถานะ Distance Volume: §aยืนยันแล้ว — ${attenuationLabel(acceptedLevel)} (ระดับ ${acceptedLevel})§r\n`
              );
            } else {
              attenuationConfirmText.setData(
                `สถานะ Distance Volume: §cไม่รับค่าที่ขอ — ใช้ ${attenuationLabel(confirmedAttenuation)}§r\n`
              );
            }

            pendingAttenuation = null;
            pendingAttenuationRequestId = "";
            pendingAttenuationChecks = 0;
            nextAttenuationSyncTick = system.currentTick + 100;
          } else {
            pendingAttenuationChecks++;
            if (pendingAttenuationChecks >= 40) {
              attenuationConfirmText.setData(
                snapshot.available
                  ? `สถานะ Distance Volume: §6ยังไม่ได้ ACK — server ยังรายงานระดับ ${snapshot.value}§r\n`
                  : "สถานะ Distance Volume: §cไม่พบ attenuation contract — ต้องใช้ VC Mumble Endstone v0.4.2+§r\n"
              );
            }
          }
        } else {
          if (
            false && // Deliberately disable unused periodic attenuation sync.
            !attenuationSyncRequestId &&
            system.currentTick >= nextAttenuationSyncTick
          ) {
            attenuationSyncRequestId = requestAttenuationSync(player);
            attenuationSyncChecks = 0;
            nextAttenuationSyncTick = system.currentTick + 100;
          }

          if (attenuationSyncRequestId) {
            const syncAck = consumeAttenuationAck(
              player,
              attenuationSyncRequestId
            );
            const snapshot = serverAttenuationSnapshot(player);

            if (syncAck || snapshot.available) {
              const syncLevel = syncAck?.value ?? snapshot.value;
              if (syncLevel >= 0 && syncLevel <= 4) {
                confirmedAttenuation = syncLevel;
              }
              attenuationConfirmText.setData(
                `สถานะ Distance Volume: §aเชื่อมต่อแล้ว — ${attenuationLabel(confirmedAttenuation)} (ระดับ ${confirmedAttenuation})§r\n`
              );
              attenuationSyncRequestId = "";
              attenuationSyncChecks = 0;
              nextAttenuationSyncTick = system.currentTick + 100;
            } else {
              attenuationSyncChecks++;
              if (attenuationSyncChecks >= 40) {
                attenuationConfirmText.setData(
                  "สถานะ Distance Volume: §cไม่พบ attenuation contract — ตรวจสอบ VC Mumble Endstone v0.4.2+§r\n"
                );
                attenuationSyncRequestId = "";
                attenuationSyncChecks = 0;
                nextAttenuationSyncTick = system.currentTick + 100;
              }
            }
          }
        }
      } catch (e) {
        console.warn(
          `[VCMumbleItem/BP] settings refresh failed player=${player.name}: ${e}`
        );
      }
    }, RANGE_UI_REFRESH_TICKS);

    await form.show();
  } catch (e) {
    console.warn(`[VCMumbleItem/BP] DDUI form failed player=${player.name}: ${e}`);
  } finally {
    if (previewPollId !== undefined) system.clearRun(previewPollId);
    if (refreshId !== undefined) system.clearRun(refreshId);
    openSettingsForms.delete(player.id);
    openSettingsPlayers.delete(player.id);
  }
}

function handleMicUse(player) {
  if (!player) return;
  system.run(() => showSettings(player));
}

system.beforeEvents.startup.subscribe((ev) => {
  ev.itemComponentRegistry.registerCustomComponent("vcmumble:open_settings", {
    onUse(arg) {
      handleMicUse(arg.source);
    },
  });
  ev.itemComponentRegistry.registerCustomComponent("vcmumble:open_phone", {
    onUse(arg) {
      handlePhoneUse(arg.source);
    },
  });
});

world.afterEvents.playerSpawn.subscribe((ev) => {
  const player = ev.player;
  system.run(() => {
    if (ev.initialSpawn === true) {
      cleanupLegacyVoiceCraftBridgeTags(player);
      migrateDynamicProperties(player);
      states.delete(player.id);

      try {
        if (player.getDynamicProperty(PROP_WELCOME_SHOWN) !== true) {
          player.setDynamicProperty(PROP_WELCOME_SHOWN, true);
          system.runTimeout(() => {
            try {
              player.sendMessage(
                "§b[ Sleepy Voice Chat ]§r ถือไอเทมไมค์จะเปิดไมค์ สลับไปช่องอื่นแล้วกลับมาช่องไมค์อีกครั้งเพื่อปิด"
              );
            } catch {}
          }, 30);
        }
      } catch {}
    }

    migrateLegacyItems(player);
    ensureMic(player);
    reassertMicFlags(player);
    syncVoiceRangeFromServer(player);
    states.delete(player.id);
    evaluate(player);

    console.warn(
      `[VCMumbleItem/BP] READY player=${player.name} mode=${getMode(player)} range=${currentVoiceRange(player)} micTag=${stateFor(player).effective ? "on" : "off"}`
    );
  });
});

world.afterEvents.playerLeave.subscribe((ev) => {
  states.delete(ev.playerId);
  globalRangePending.delete(ev.playerId);
  globalRangeResults.delete(ev.playerId);
  lastRangePreviewTick.delete(ev.playerId);
  rangeChangeCooldownUntil.delete(ev.playerId);
  openSettingsPlayers.delete(ev.playerId);
  openSettingsForms.delete(ev.playerId);
  openPhonePlayers.delete(ev.playerId);
});

// One-tick evaluation keeps Hold-to-Talk responsive and immediately mirrors
// the state into vcmumble.mic.on/off for the Endstone plugin.
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      evaluate(player);
    } catch (e) {
      console.warn(`[VCMumbleItem/BP] evaluate failed player=${player.name}: ${e}`);
    }
  }
}, 1);

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      // One inventory verification per five seconds, NOT per tick.
      migrateLegacyItems(player);
      ensureMic(player);
      reassertMicFlags(player);
      if (!globalRangePending.has(player.id)) syncVoiceRangeFromServer(player);
      const state = stateFor(player);
      state.micKnown = hasAnyMic(player);
      // evaluate applies newly issued Mic once and repairs tags only when needed.
      if (!state.micKnown) states.delete(player.id);
    } catch (e) {
      console.warn(`[VCMumbleItem/BP] mic maintenance failed player=${player.name}: ${e}`);
    }
  }
}, MIC_MAINTENANCE_INTERVAL_TICKS);

// ACK/timeouts continue to be processed if the player closes the DDUI.
system.runInterval(() => {
  try { pollGlobalRangeRequests(); } catch (e) {
    console.warn(`[VCMumbleItem/BP] global range poll failed: ${e}`);
  }
}, 5);

system.run(() => {
  try { resetPhoneCallsOnLoad(); } catch {}
});

system.runInterval(() => {
  try { maintainPhoneCalls(); } catch (e) {
    console.warn(`[VCMumbleItem/BP] call maintenance failed: ${e}`);
  }
}, 10);

console.warn(
  "[VCMumbleItem/BP] Loaded v2.18.3 Preview — self-only waist range ring + fail-closed Mic + safe range ACK"
);
