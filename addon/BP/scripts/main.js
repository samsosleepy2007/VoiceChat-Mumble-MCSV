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
const DEFAULT_MAX_RANGE = 150;
const VOICE_RANGE_PREVIEW_PREFIX = "vcmumble:voice_range_preview_";
const VOICE_RANGE_SLIDER_SETTLE_TICKS = 15;
const VOICE_RANGE_CHANGE_COOLDOWN_TICKS = 20 * 5;
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
  if (legacy === MODE_TOGGLE) {
    player.setDynamicProperty(PROP_MODE, MODE_TOGGLE);
    return MODE_TOGGLE;
  }
  return MODE_HOLD;
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
        const item = inv.getItem(i);
        if (!item || !isMicId(item.typeId)) continue;
        const slot = inv.getSlot(i);
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
    try {
      if (player.hasTag(unwanted)) player.removeTag(unwanted);
    } catch {}
    try {
      if (!player.hasTag(wanted)) player.addTag(wanted);
    } catch {}

    let tags = [];
    try {
      tags = player.getTags();
    } catch {}
    const correct = tags.includes(wanted) && !tags.includes(unwanted);

    // Command fallback repairs tag state if Script API tag mutation did not
    // become visible immediately to Endstone. Only runs when verification fails.
    if (!correct) {
      try { player.runCommand(`tag @s remove ${unwanted}`); } catch {}
      try { player.runCommand(`tag @s add ${wanted}`); } catch {}
    }
  } catch (e) {
    console.warn(`[VCMumbleItem/BP] mic tag sync failed player=${player.name}: ${e}`);
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

  const effective = offMic || (mode === MODE_HOLD ? mainMic : latch);
  state = {
    mode,
    micKnown: hasAnyMic(player),
    appliedEffective: undefined,
    publishedEffective: undefined,
    lastPublishedTick: -100,
    lastMainMic: mainMic,
    toggleLatched: latch,
    effective,
  };
  states.set(player.id, state);
  return state;
}

function evaluate(player) {
  // Keep inventory maintenance out of the per-tick path.
  const state = stateFor(player);
  const mainMic = isMicId(getMainId(player));
  const offMic = isMicId(getOffId(player));
  const hasMic = state.micKnown || mainMic || offMic;
  const mode = getMode(player);

  if (mode !== state.mode) {
    if (mode === MODE_TOGGLE) {
      state.toggleLatched = !!(mainMic && !offMic);
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
    hasMic && (offMic || (mode === MODE_HOLD ? mainMic : state.toggleLatched));

  if (effective !== state.effective) {
    state.effective = effective;
    console.warn(
      `[VCMumbleItem/BP] MIC_LOCAL player=${player.name} mic=${effective ? "ON" : "OFF"} mode=${mode}`
    );
  }

  const wantedId = effective ? MIC_ON : MIC_OFF;
  if (state.appliedEffective !== effective ||
      (mainMic && getMainId(player) !== wantedId) ||
      (offMic && getOffId(player) !== wantedId)) {
    replaceMicStatus(player, effective);
    state.appliedEffective = effective;
  }
  if (state.publishedEffective !== effective || system.currentTick - state.lastPublishedTick >= 100) {
    publishMicState(player, effective);
    state.publishedEffective = effective;
    state.lastPublishedTick = system.currentTick;
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

  const current = readPhoneProfile(String(message?.senderPhoneId ?? ""));
  if (current?.icName) return current.icName;
  const fallback = String(message?.senderName ?? "").trim();
  return fallback || "ไม่ทราบชื่อ";
}

function notifyPhoneRecipient(phoneId, message) {
  const senderName = resolveIncomingMessageName(phoneId, message);
  const senderNumber = message?.anonymous === true
    ? ANONYMOUS_NUMBER
    : String(message?.senderNumber ?? "");

  for (const target of world.getAllPlayers()) {
    if (!playerHasPhoneId(target, phoneId)) continue;
    try {
      target.sendMessage(`§b[ SleepyPhone ]§r : มีข้อความจาก ${senderNumber} ${senderName}`);
    } catch {}
  }
}

let phoneCallSequence = 0;
const phoneCalls = new Map();
const playerPhoneCalls = new Map();
const PHONE_CALL_TAG = "vcmumble.call.active.";
function phoneCallFor(player) { return phoneCalls.get(playerPhoneCalls.get(player.id)); }
function callPlayer(id) { return world.getAllPlayers().find(p => p.id === id); }
function clearPhoneCallTags(player) {
  if (!player) return;
  for (const tag of player.getTags()) if (tag.startsWith(PHONE_CALL_TAG)) player.removeTag(tag);
}
function endPhoneCall(call, reason = "จบการโทรแล้ว") {
  if (!call || !phoneCalls.has(call.id)) return;
  phoneCalls.delete(call.id);
  for (const id of [call.a, call.b]) {
    playerPhoneCalls.delete(id);
    const participant = callPlayer(id);
    if (participant) {
      try { clearPhoneCallTags(participant); participant.sendMessage(`[ SleepyPhone ] ${reason}`); } catch {}
    }
  }
}
function startPhoneCall(player, ownProfile, targetProfile, anonymous) {
  if (phoneCallFor(player)) return "คุณมีสายอยู่แล้ว";
  if (phoneItemData(currentPhoneSlot(player))?.id !== ownProfile.id) return "กรุณาถือโทรศัพท์เครื่องเดิม";
  if (!targetProfile || targetProfile.id === ownProfile.id) return "ไม่สามารถโทรหาเบอร์นี้ได้";
  const target = world.getAllPlayers().find(p => p.id !== player.id && playerHasPhoneId(p, targetProfile.id));
  if (!target) return "ปลายสายไม่ออนไลน์หรือไม่มีโทรศัพท์เครื่องนี้";
  if (phoneCallFor(target)) return "ปลายสายติดสายอยู่";
  const call = { id: `c${Date.now().toString(36)}${++phoneCallSequence}`, a: player.id, b: target.id,
    phoneA: ownProfile.id, phoneB: targetProfile.id, callerName: ownProfile.icName,
    callerNumber: ownProfile.number, targetName: targetProfile.icName, targetNumber: targetProfile.number,
    anonymous, state: "ringing", expires: system.currentTick + 1200 };
  phoneCalls.set(call.id, call);
  playerPhoneCalls.set(call.a, call.id); playerPhoneCalls.set(call.b, call.id);
  player.sendMessage(`[ SleepyPhone ] กำลังโทรไปที่เบอร์ ${targetProfile.number} ใช้โทรศัพท์เพื่อดูสถานะ`);
  const contact = readPhoneContacts(targetProfile.id).find(c => c.phoneId === ownProfile.id);
  const identity = anonymous ? "ไม่ระบุตัวตน" : `${contact?.name || ownProfile.icName} (${ownProfile.number})`;
  target.sendMessage(`[ SleepyPhone ] มีสายเข้าจาก ${identity} ใช้โทรศัพท์เพื่อรับหรือตัดสาย`);
  return "";
}
function acceptPhoneCall(player) {
  const call = phoneCallFor(player);
  if (!call || call.b !== player.id || call.state !== "ringing") return;
  const a = callPlayer(call.a), b = callPlayer(call.b);
  if (!a || !b || system.currentTick >= call.expires) { endPhoneCall(call, "สายหมดเวลาแล้ว"); return; }
  if (phoneItemData(currentPhoneSlot(a))?.id !== call.phoneA || phoneItemData(currentPhoneSlot(b))?.id !== call.phoneB) {
    endPhoneCall(call, "สายหลุด เพราะไม่ได้ถือโทรศัพท์ไว้"); return;
  }
  try {
    clearPhoneCallTags(a); clearPhoneCallTags(b);
    a.addTag(`${PHONE_CALL_TAG}${call.id}.a.0`);
    b.addTag(`${PHONE_CALL_TAG}${call.id}.b.0`);
    call.state = "active";
    a.sendMessage("[ SleepyPhone ] รับสายแล้ว คุยกันได้โดยไม่จำกัดระยะ");
    b.sendMessage("[ SleepyPhone ] รับสายแล้ว คุยกันได้โดยไม่จำกัดระยะ");
  } catch { endPhoneCall(call, "เชื่อมต่อสายไม่สำเร็จ"); }
}
function togglePhoneSpeaker(player) {
  const call = phoneCallFor(player);
  if (!call || call.state !== "active") return false;
  const role = call.a === player.id ? "a" : "b";
  const field = role === "a" ? "speakerA" : "speakerB";
  const enabled = !call[field];
  // Publish the new flag before removing the old one, so the bridge always
  // sees a complete two-party call rather than a transient call_end.
  player.addTag(`${PHONE_CALL_TAG}${call.id}.${role}.${enabled ? 1 : 0}`);
  player.removeTag(`${PHONE_CALL_TAG}${call.id}.${role}.${enabled ? 0 : 1}`);
  call[field] = enabled;
  player.sendMessage(`[ SleepyPhone ] ลำโพง: ${enabled ? "เปิด" : "ปิด"}`);
  return enabled;
}
system.runInterval(() => {
  for (const call of phoneCalls.values()) {
    const a = callPlayer(call.a), b = callPlayer(call.b);
    if (!a || !b) { endPhoneCall(call, "ปลายสายออกจากเซิร์ฟเวอร์แล้ว"); continue; }
    if (call.state === "ringing" && system.currentTick >= call.expires) { endPhoneCall(call, "ไม่มีผู้รับสาย"); continue; }
    if (phoneItemData(currentPhoneSlot(a))?.id !== call.phoneA ||
        (call.state === "active" && phoneItemData(currentPhoneSlot(b))?.id !== call.phoneB)) {
      endPhoneCall(call, "สายหลุด เพราะไม่ได้ถือโทรศัพท์ไว้");
    }
  }
}, 10);

const openPhonePlayers = new Set();

async function showPhone(player) {
  if (!player) return;
  if (openPhonePlayers.has(player.id)) return;
  if (openSettingsPlayers.has(player.id)) {
    player.sendMessage("§e[SleepyPhone] กรุณาปิดหน้าตั้งค่า Mic ก่อน§r");
    return;
  }

  const initial = resolvePhoneProfile(player);
  if (!initial.slot) {
    player.sendMessage("§c[SleepyPhone] ไม่พบโทรศัพท์ที่กำลังใช้งาน§r");
    return;
  }

  openPhonePlayers.add(player.id);
  try {
    const pageNames = [
      "setupName", "setupNumber", "home", "bank", "sendMethod", "sendNumber", "contacts",
      "addContact", "contactDetail", "deleteContact", "compose", "inbox", "messageDetail",
      "callMethod", "callNumber", "callContacts", "callStatus",
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
    const bankStatus = new ObservableString("");

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

    const callNumberInput = new ObservableString("", { clientWritable: true });
    const callStatusText = new ObservableString("");
    const callAnonymousLabel = new ObservableString("ไม่ระบุตัวตน: ปิด");
    const callAcceptVisible = new ObservableBoolean(false);
    const callSpeakerVisible = new ObservableBoolean(false);
    const callSpeakerLabel = new ObservableString("ลำโพง: ปิด");
    const callContactVisible = Array.from({length: PHONE_CONTACT_LIMIT}, () => new ObservableBoolean(false));
    let callAnonymous = false;
    const toggleCallAnonymous = () => {
      callAnonymous = !callAnonymous;
      callAnonymousLabel.setData(`ไม่ระบุตัวตน: ${callAnonymous ? "เปิด" : "ปิด"}`);
    };
    const openCallStatus = () => {
      const call = phoneCallFor(player);
      if (!call) { callStatusText.setData("ไม่มีสายอยู่ในขณะนี้"); showPage("callMethod"); return; }
      const incoming = call.b === player.id;
      const identity = incoming ? (call.anonymous ? "ไม่ระบุตัวตน" : `${call.callerName} (${call.callerNumber})`) : `${call.targetName} (${call.targetNumber})`;
      callStatusText.setData(`\n${call.state === "active" ? "กำลังคุยสาย" : incoming ? "มีสายเข้า" : "กำลังรอรับสาย"}\n\n${identity}\n`);
      callAcceptVisible.setData(incoming && call.state === "ringing");
      callSpeakerLabel.setData(`ลำโพง: ${(incoming ? call.speakerB : call.speakerA) ? "เปิด" : "ปิด"}`);
      showPage("callStatus");
    };
    const openCallMethod = () => {
      if (phoneCallFor(player)) { openCallStatus(); return; }
      callStatusText.setData(""); showPage("callMethod");
    };
    const dialProfile = target => {
      if (!activeProfile) return;
      const error = startPhoneCall(player, activeProfile, target, callAnonymous);
      if (error) { callStatusText.setData(`\n${error}\n`); return; }
      form.close();
    };
    const dialNumber = () => {
      const number = String(callNumberInput.getData() ?? "").trim();
      if (!/^\d{4}$/.test(number)) { callStatusText.setData("กรุณากรอกเบอร์ 4 หลัก"); return; }
      dialProfile(readPhoneProfileByNumber(number));
    };
    const openCallContacts = () => { refreshContacts(); callStatusText.setData(""); showPage("callContacts"); };

    let pendingIcName = initial.profile?.icName ?? "";
    let activeProfile = initial.profile;
    let contactsCache = [];
    let favoritesCache = [];
    let inboxCache = [];
    let selectedContact = undefined;
    let contactDetailBackPage = "contacts";
    let selectedMessage = undefined;
    let composeRecipient = undefined;
    let addContactBusy = false;

    // DDUI list buttons are created once and persist for the lifetime of the form.
    // Their visibility therefore has to be scoped to both the page and whether
    // that list slot currently contains data. Otherwise a normal contact button
    // can leak into Home, Send by Number, Inbox, or appear under Favorites.
    syncDynamicButtonVisibility = () => {
      const currentCall = phoneCallFor(player);
      callSpeakerVisible.setData(currentPhonePage === "callStatus" && currentCall?.state === "active");
      callAcceptVisible.setData(currentPhonePage === "callStatus" && currentCall?.b === player.id && currentCall?.state === "ringing");
      for (let i = 0; i < PHONE_CONTACT_LIMIT; i++) {
        callContactVisible[i].setData(currentPhonePage === "callContacts" && contactButtonHasData[i] === true);
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
      inboxCache = readPhoneInbox(activeProfile.id);
      const unread = inboxCache.filter((message) => !message.read).length;
      inboxHomeButtonLabel.setData(
        unread > 0 ? `[${unread}] กล่องข้อความ` : "กล่องข้อความ"
      );
      inboxSummary.setData(
        `\nข้อความทั้งหมด: §b${inboxCache.length}§r\n\nยังไม่อ่าน: §c${unread}§r\n`
      );
      inboxEmptyText.setData(inboxCache.length === 0 ? "\nยังไม่มีข้อความ\n" : "");
      for (let i = 0; i < PHONE_INBOX_LIMIT; i++) {
        const message = inboxCache[i];
        if (message) {
          const prefix = message.read ? "" : "[!] ";
          const displayName = resolveIncomingMessageName(activeProfile.id, message);
          const displayNumber = message.anonymous ? ANONYMOUS_NUMBER : message.senderNumber;
          inboxButtonLabels[i].setData(`${prefix}${displayName} - ${displayNumber}`);
          inboxButtonHasData[i] = true;
        } else {
          inboxButtonLabels[i].setData("");
          inboxButtonHasData[i] = false;
        }
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

    const openContacts = () => {
      contactDetailStatus.setData("");
      refreshContacts();
      showPage("contacts");
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
        displayName: displayName || targetProfile.icName,
      };
      composeInput.setData("");
      anonymousToggle.setData(false);
      composeStatus.setData("");
      composeRecipientText.setData(
        `\nถึง: §f${composeRecipient.displayName}§r\n\nเบอร์: §b${composeRecipient.number}§r\n`
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

    const contactCallPlaceholder = () => {
      if (!selectedContact) return;
      callNumberInput.setData(selectedContact.number);
      callStatusText.setData("");
      showPage("callNumber");
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
        const inbox = readPhoneInbox(target.id);
        inbox.unshift(message);
        writePhoneInbox(target.id, inbox);
        notifyPhoneRecipient(target.id, message);
        composeStatus.setData("\n§aส่งข้อความสำเร็จ§r\n");
        composeInput.setData("");

        system.runTimeout(() => {
          openSendMethod();
        }, 20);
      } catch (e) {
        console.warn(`[VCMumbleItem/BP] send message failed player=${player.name}: ${e}`);
        composeStatus.setData("\n§cส่งข้อความไม่สำเร็จ กรุณาลองใหม่§r\n");
      }
    };

    const openInbox = () => {
      messageDetailStatus.setData("");
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
        `\nชื่อ: §f${displayName}§r\n\nเบอร์: §b${displayNumber}§r\n\nวันที่: §f${stamp.date}§r\n\nเวลา: §f${stamp.time}§r\n\nข้อความ:\n\n§f${message.body}§r\n`
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
      .button("ธนาคาร", () => {
        bankStatus.setData("");
        showPage("bank");
      }, { visible: pages.home })
      .button("ตั้งค่า", () => homeStatus.setData("\nApplication ตั้งค่าเตรียมไว้สำหรับพัฒนาต่อ\n"), { visible: pages.home })
      .spacer({ visible: pages.home })
      .header("Favorites", { visible: pages.home })
      .label(favoritesInfo, { visible: pages.home });

    for (let i = 0; i < PHONE_CONTACT_LIMIT; i++) {
      form.button(favoriteButtonLabels[i], () => openFavoriteAt(i), { visible: favoriteButtonVisible[i] });
    }

    form
      .header("โทร", { visible: pages.callMethod })
      .button("โทรด้วยเบอร์", () => { callStatusText.setData(""); showPage("callNumber"); }, { visible: pages.callMethod })
      .button("โทรด้วยรายชื่อ", openCallContacts, { visible: pages.callMethod })
      .button("ย้อนกลับ", openHome, { visible: pages.callMethod })
      .header("โทรด้วยเบอร์", { visible: pages.callNumber })
      .textField("เบอร์ 4 หลัก", callNumberInput, { visible: pages.callNumber })
      .button(callAnonymousLabel, toggleCallAnonymous, { visible: pages.callNumber })
      .label(callStatusText, { visible: pages.callNumber })
      .button("โทร", dialNumber, { visible: pages.callNumber })
      .button("ย้อนกลับ", openCallMethod, { visible: pages.callNumber })
      .header("โทรด้วยรายชื่อ", { visible: pages.callContacts })
      .label(contactEmptyText, { visible: pages.callContacts })
      .button(callAnonymousLabel, toggleCallAnonymous, { visible: pages.callContacts })
      .label(callStatusText, { visible: pages.callContacts });
    for (let i = 0; i < PHONE_CONTACT_LIMIT; i++) {
      form.button(contactButtonLabels[i], () => {
        const contact = contactsCache[i];
        if (contact) dialProfile(readPhoneProfile(contact.phoneId) ?? readPhoneProfileByNumber(contact.number));
      }, { visible: callContactVisible[i] });
    }
    form
      .button("ย้อนกลับ", openCallMethod, { visible: pages.callContacts })
      .header("สถานะการโทร", { visible: pages.callStatus })
      .label(callStatusText, { visible: pages.callStatus })
      .button("รับสาย", () => { acceptPhoneCall(player); form.close(); }, { visible: callAcceptVisible })
      .button(callSpeakerLabel, () => {
        const enabled = togglePhoneSpeaker(player);
        callSpeakerLabel.setData(`ลำโพง: ${enabled ? "เปิด" : "ปิด"}`);
      }, { visible: callSpeakerVisible })
      .button("ตัดสาย", () => { endPhoneCall(phoneCallFor(player)); form.close(); }, { visible: pages.callStatus })
      .button("ย้อนกลับ", openHome, { visible: pages.callStatus });

    form
      .spacer({ visible: pages.home })
      .label(homeStatus, { visible: pages.home })

      .header("ธนาคาร", { visible: pages.bank })
      .label("\nเลขบัญชี: ยังไม่ได้เปิดบัญชี\n\nจำนวนเงิน: 0\n", { visible: pages.bank })
      .button("โอนเงิน", () => bankStatus.setData("\nระบบโอนเงินเตรียมไว้สำหรับพัฒนาต่อ\n"), { visible: pages.bank })
      .button("ทัชสแกน", () => bankStatus.setData("\nระบบทัชสแกนเตรียมไว้สำหรับพัฒนาต่อ\n"), { visible: pages.bank })
      .label(bankStatus, { visible: pages.bank })
      .button("ย้อนกลับ", openHome, { visible: pages.bank })

      .header("ส่งข้อความ", { visible: pages.sendMethod })
      .label("\nเลือกวิธีระบุผู้รับข้อความ\n", { visible: pages.sendMethod })
      .button("ส่งด้วยเบอร์", openDirectNumber, { visible: pages.sendMethod })
      .button("ส่งด้วยรายชื่อ", openContacts, { visible: pages.sendMethod })
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
      .button("ย้อนกลับ", openSendMethod, { visible: pages.contacts })

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
      .button("โทร", contactCallPlaceholder, { visible: pages.contactDetail })
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

      .header("กล่องข้อความ", { visible: pages.inbox })
      .label(inboxSummary, { visible: pages.inbox })
      .label(inboxEmptyText, { visible: pages.inbox });

    for (let i = 0; i < PHONE_INBOX_LIMIT; i++) {
      form.button(inboxButtonLabels[i], () => openMessageAt(i), { visible: inboxButtonVisible[i] });
    }

    form
      .button("ย้อนกลับ", openHome, { visible: pages.inbox })

      .header("ข้อความ", { visible: pages.messageDetail })
      .label(messageDetailText, { visible: pages.messageDetail })
      .button("ตอบกลับ", replySelectedMessage, { visible: pages.messageDetail })
      .button("ลบข้อความ", deleteSelectedMessage, { visible: pages.messageDetail })
      .button("ย้อนกลับ", openInbox, { visible: pages.messageDetail })
      .label(messageDetailStatus, { visible: pages.messageDetail });

    if (phoneCallFor(player)) openCallStatus();
    await form.show();
  } catch (e) {
    console.warn(`[VCMumbleItem/BP] phone DDUI failed player=${player.name}: ${e}`);
  } finally {
    openPhonePlayers.delete(player.id);
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
    player.setDynamicProperty(PROP_VOICE_RANGE, serverValue);
    return serverValue;
  }

  const stored = Number(player.getDynamicProperty(PROP_VOICE_RANGE));
  if (Number.isFinite(stored) && stored >= 1) return Math.floor(stored);

  const legacy = Number(player.getDynamicProperty(LEGACY_PROP_VOICE_RANGE));
  if (Number.isFinite(legacy) && legacy >= 1) return Math.floor(legacy);

  return DEFAULT_VOICE_RANGE;
}

function currentMaxRange(player) {
  return readTaggedNumber(player, RANGE_MAX_PREFIX, DEFAULT_MAX_RANGE);
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
  if (serverValue >= 1) {
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
    return requestId;
  } catch (e) {
    console.warn(
      `[VCMumbleItem/BP] voice range request failed player=${player.name}: ${e}`
    );
    return "";
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
    setLatch(player, !!(mainMic && !offMic));
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

function voiceRangePreviewParticleId(radius) {
  return VOICE_RANGE_PREVIEW_PREFIX + String(radius).padStart(3, "0");
}

function showVoiceRangePreview(player, rawRadius) {
  const radius = Math.max(1, Math.min(150, Math.floor(Number(rawRadius) || 1)));
  const particleId = voiceRangePreviewParticleId(radius);

  let center;
  try {
    center = player.location;
  } catch {
    return;
  }

  try {
    // Static RP definitions avoid MolangVariableMap/runtime scaling entirely.
    player.spawnParticle(
      particleId,
      { x: center.x, y: center.y + 0.04, z: center.z }
    );
    player.spawnParticle(
      particleId,
      { x: center.x, y: center.y + radius, z: center.z }
    );
  } catch {
    // Preview failure must never block range updates or DDUI.
  }
}

const openSettingsPlayers = new Set();
const openSettingsForms = new Map();
const settingsRefreshJobs = new Map();
const settingsReopenAfter = new Map();

const pendingMicUiOpens = new Map();
const micUiNoticeAfter = new Map();
function notifyMicUiCooldown(player) {
  if (system.currentTick < (micUiNoticeAfter.get(player.id) ?? 0)) return;
  micUiNoticeAfter.set(player.id, system.currentTick + 40);
  player.sendMessage("[ SleepyMic ] ติดคูลดาวน์การใช้ โปรดรอสักครู่และลองอีกครั้ง");
}

async function showSettings(player) {
  const playerId = player.id;
  if (openSettingsPlayers.has(playerId)) return;
  if (voiceRangeCooldownTicks(player) > 0 || system.currentTick < (settingsReopenAfter.get(playerId) ?? 0)) {
    notifyMicUiCooldown(player);
    return;
  }
  openSettingsPlayers.add(playerId);
  console.warn(`[VCMumbleItem/BP] MIC_UI_OPEN player=${player.name} cooldown=${voiceRangeCooldownTicks(player)}`);
  let refreshId;

  try {
    // Opening the UI only reads state; inventory and sync run independently.
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
    const rangeConfirmText = new ObservableString("สถานะ Endstone: ใช้ค่าปัจจุบัน\n");
    const attenuationText = new ObservableString(
      `เสียงตามระยะ: §d${attenuationLabel(initialAttenuation)} (ระดับ ${initialAttenuation})§r\n`
    );
    const attenuationConfirmText = new ObservableString("สถานะ Distance Volume: ใช้ค่าปัจจุบัน\n");
    const offhandText = new ObservableString(
      isMicId(getOffId(player))
        ? "มือซ้าย: §aMic อยู่มือซ้าย — บังคับ ON§r\n"
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
        ? "คูลดาวน์เปลี่ยนระยะ: §eกำลังคูลดาวน์§r\n"
        : "คูลดาวน์เปลี่ยนระยะ: §aพร้อมเปลี่ยนได้§r\n"
    );
    let lastSliderRange = Math.floor(rangeSlider.getData());
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
      if (cooldownTicks > 0 || pendingRequestId) {
        queuedSliderRange = null;
        sliderCandidateRange = null;
        return;
      }

      const requestId = requestVoiceRange(player, value);
      if (!requestId) {
        rangeConfirmText.setData("สถานะ Endstone: §cส่งคำขอระยะเสียงไม่สำเร็จ§r\n");
        return;
      }

      pendingRange = value;
      pendingRequestId = requestId;
      rangeControlsVisible.setData(false);
      pendingChecks = 0;
      syncRequestId = "";
      syncChecks = 0;
      customRange.setData(String(value));

      const maxNow = sliderMax.getData();
      if (value >= 1 && value <= maxNow) {
        lastSliderRange = value;
        rangeSlider.setData(value);
      }

      rangeConfirmText.setData(
        `สถานะ Endstone: §eกำลังรอยืนยัน ${value} บล็อก...§r\n`
      );
    };

    const submitQuickRange = (rawValue) => {
      const value = Math.floor(Number(rawValue));
      if (!Number.isFinite(value) || value < 1) return;

      lastSliderRange = value;
      rangeSlider.setData(value);
      // Range preview disabled; keep the realtime range request.

      // Repeated taps on the same quick button must not create duplicate
      // requests. If a request is pending, retain only the newest value.
      if (value === pendingRange) return;
      if (!pendingRequestId && value === confirmedRange) {
        rangeConfirmText.setData(
          `สถานะ Endstone: §aใช้อยู่แล้ว — ${value} บล็อก§r\n`
        );
        return;
      }
      if (pendingRequestId) return;

      queuedSliderRange = null;
      sliderCommitDueTick = 0;
      submitRange(value);
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
    const rangeControlsVisible = new ObservableBoolean(initialCooldownSeconds <= 0);
    const settingsPageVisible = new ObservableBoolean(false);
    const resetVisible = new ObservableBoolean(false);
    const showMainPage = () => {
      mainPageVisible.setData(true);
      settingsPageVisible.setData(false);
      resetVisible.setData(false);
      rangeControlsVisible.setData(voiceRangeCooldownTicks(player) <= 0 && !pendingRequestId);
    };
    const showSettingsPage = () => {
      mainPageVisible.setData(false);
      settingsPageVisible.setData(true);
      resetVisible.setData(voiceRangeCooldownTicks(player) <= 0 && !pendingRequestId);
      rangeControlsVisible.setData(false);
    };

    const form = new CustomForm(player, "VC Mumble • Mic Settings")
      .header("สถานะ", { visible: mainPageVisible })
      .label(modeText, { visible: mainPageVisible })
      .label(rangeText, { visible: mainPageVisible })
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
      .spacer({ visible: mainPageVisible })
      .slider("ระยะเสียงแบบ Slider", rangeSlider, 1, sliderMax, {
        step: 1,
        visible: rangeControlsVisible,
        description:
          "ลากแล้วปล่อย เมื่อหยุดประมาณ 0.75 วิ จะใช้ระยะที่เลือกและปิดหน้าจอ",
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
      .label("คืน Mic Mode เป็น Hold-to-Talk\nVoice Range = 30 บล็อก\n", {
        visible: settingsPageVisible,
      })
      .button("คืนค่าเริ่มต้น", () => {
        if (voiceRangeCooldownTicks(player) > 0 || pendingRequestId) return;
        queuedSliderRange = null;
        sliderCandidateRange = null;
        const resetRange = isOperator(player) ? 30 : Math.min(30, sliderMax.getData());
        customRange.setData(String(resetRange));
        lastSliderRange = Math.min(resetRange, sliderMax.getData());
        rangeSlider.setData(lastSliderRange);
        applyMicModeFromUi(
          player,
          MODE_HOLD,
          statusText,
          modeText,
          holdDisabled,
          toggleDisabled
        );
        submitRange(resetRange);
        resetVisible.setData(false);
      }, { visible: resetVisible })
      .spacer({ visible: settingsPageVisible })
      .button("กลับหน้าหลัก", showMainPage, {
        visible: settingsPageVisible,
      })
      .closeButton();

    openSettingsForms.set(player.id, form);

    // Only read the slider and check the user's pending request.
    // No periodic sync or realtime status writes to DDUI.
    refreshId = system.runInterval(() => {
      try {
        if (!player.isValid) return;
        if (pendingRequestId) {
          const ack = consumeVoiceRangeAck(player, pendingRequestId);
          const snapshot = serverVoiceRangeSnapshot(player);
          const accepted = ack
            ? ack.status === "ok" && ack.value === pendingRange
            : snapshot.available && snapshot.value === pendingRange;
          if (accepted) {
            const value = ack?.value ?? snapshot.value;
            pendingRequestId = "";
            pendingRange = null;
            player.setDynamicProperty(PROP_VOICE_RANGE, value);
            startVoiceRangeCooldown(player);
            player.sendMessage(`[ SleepyMic ] เปลี่ยนระยะเป็น ${value} บล็อกแล้ว`);
            system.clearRun(refreshId);
            refreshId = undefined;
            settingsRefreshJobs.delete(playerId);
            form.close();
            return;
          }
          pendingChecks++;
          if (ack || pendingChecks >= 40) {
            pendingRequestId = "";
            pendingRange = null;
            player.sendMessage("[ SleepyMic ] เปลี่ยนระยะไม่สำเร็จ โปรดลองอีกครั้ง");
            system.clearRun(refreshId);
            refreshId = undefined;
            settingsRefreshJobs.delete(playerId);
            form.close();
          }
          return;
        }
        if (!mainPageVisible.getData() || !rangeControlsVisible.getData()) return;
        const value = Math.max(1, Math.min(Math.floor(rangeSlider.getData()), sliderMax.getData()));
        if (value !== lastSliderRange) {
          lastSliderRange = value;
          sliderCandidateRange = value;
          sliderSettleDueTick = system.currentTick + VOICE_RANGE_SLIDER_SETTLE_TICKS;
          return;
        }
        if (sliderCandidateRange !== null && system.currentTick >= sliderSettleDueTick) {
          const settled = sliderCandidateRange;
          sliderCandidateRange = null;
          if (settled !== confirmedRange) submitRange(settled);
        }
      } catch (error) {
        console.warn(`[VCMumbleItem/BP] MIC_UI_MONITOR_FAILED player=${playerId}: ${error}`);
      }
    }, 5);
    settingsRefreshJobs.set(playerId, refreshId);

    await form.show();
  } catch (e) {
    console.warn(`[VCMumbleItem/BP] DDUI form failed player=${player.name}: ${e}`);
  } finally {
    if (refreshId !== undefined) system.clearRun(refreshId);
    settingsRefreshJobs.delete(playerId);
    settingsReopenAfter.set(playerId, system.currentTick + 100);
    console.warn(`[VCMumbleItem/BP] MIC_UI_CLOSE player=${playerId} reopen_delay_ticks=100`);
    openSettingsForms.delete(playerId);
    openSettingsPlayers.delete(playerId);
  }
}

function handleMicUse(player) {
  if (!player) return;
  const id = player.id;
  if (pendingMicUiOpens.has(id) || openSettingsPlayers.has(id)) return;
  if (voiceRangeCooldownTicks(player) > 0 || system.currentTick < (settingsReopenAfter.get(id) ?? 0)) {
    notifyMicUiCooldown(player);
    return;
  }
  const token = {};
  pendingMicUiOpens.set(id, token);
  try {
    system.run(async () => {
      try {
        if (pendingMicUiOpens.get(id) !== token) return;
        if (!player.isValid) return;
        await showSettings(player);
      } catch (error) {
        console.warn(`[VCMumbleItem/BP] MIC_UI_OPEN_FAILED player=${id}: ${error}`);
      } finally {
        if (pendingMicUiOpens.get(id) === token) pendingMicUiOpens.delete(id);
      }
    });
  } catch (error) {
    if (pendingMicUiOpens.get(id) === token) pendingMicUiOpens.delete(id);
    console.warn(`[VCMumbleItem/BP] MIC_UI_SCHEDULE_FAILED player=${id}: ${error}`);
  }
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
    if (ev.initialSpawn) clearPhoneCallTags(player);
    if (ev.initialSpawn === true) {
      cleanupLegacyVoiceCraftBridgeTags(player);
      migrateDynamicProperties(player);
      states.delete(player.id);
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
  endPhoneCall(phoneCalls.get(playerPhoneCalls.get(ev.playerId)), "ปลายสายออกจากเซิร์ฟเวอร์แล้ว");
  states.delete(ev.playerId);
  const refreshJob = settingsRefreshJobs.get(ev.playerId);
  if (refreshJob !== undefined) system.clearRun(refreshJob);
  settingsRefreshJobs.delete(ev.playerId);
  settingsReopenAfter.delete(ev.playerId);
  pendingMicUiOpens.delete(ev.playerId);
  micUiNoticeAfter.delete(ev.playerId);
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
      migrateLegacyItems(player);
      ensureMic(player);
      reassertMicFlags(player);
      syncVoiceRangeFromServer(player);
      const state = stateFor(player);
      state.micKnown = hasAnyMic(player);
      evaluate(player);
    } catch {}
  }
}, 100);

console.warn(
  "[VCMumbleItem/BP] Loaded v2.15.9 — Mic DDUI open guard + slider confirmation"
);
