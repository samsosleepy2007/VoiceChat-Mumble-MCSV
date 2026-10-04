from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor
import math
import threading
import time
from typing import Any

from endstone import Player
from endstone.command import Command, CommandSender
from endstone.form import ActionForm
from endstone.plugin import Plugin

from .host import MumbleRuntimeHost
from .listener import MumbleHostListener
from .local_state import LocalStateSink
from .model import PlayerState


ATTENUATION_LEVELS: dict[int, str] = {
    0: "ปิด",
    1: "เบา",
    2: "ปกติ",
    3: "แรง",
    4: "แรงมาก",
}


class MumbleHost(Plugin):
    prefix = "MumbleHost"
    version = "0.5.4"
    api_version = "0.11"
    description = "Unified MCSV Mumble server + Item Mic proximity + SleepyPhone call routing"
    authors = ["SamSoSleepy"]

    commands = {
        "vcb": {
            "description": "Open MumbleHost proximity status",
            "usages": ["/vcb [action: string]"],
            "permissions": ["mumble_host.command.user"],
        },
    }

    permissions = {
        "mumble_host.command.user": {
            "description": "Use MumbleHost status UI.",
            "default": True,
        },
        "mumble_host.command.admin": {
            "description": "Administer the local Mumble host.",
            "default": "op",
        },
    }

    def __init__(self) -> None:
        super().__init__()
        self._states: dict[str, PlayerState] = {}
        self._bindings: dict[str, dict[str, Any]] = {}
        self._calls: dict[str, dict[str, Any]] = {}
        # Move persistent writes out of the Endstone world tick.
        self._binding_writer: ThreadPoolExecutor | None = None
        self._host: MumbleRuntimeHost | None = None
        self._state_sink: LocalStateSink | None = None

        self._interval_ticks = 2
        self._position_epsilon = 0.05
        self._rotation_epsilon = 1.0
        self._heartbeat_ticks = 300
        self._heartbeat_accumulator = 0

        self._default_range = 30
        self._max_range = 150
        self._default_attenuation_level = 3
        self._mumble_port = 18655
        self._mumble_users = 20
        self._last_host_running = False

    def on_enable(self) -> None:
        # Endstone may enable the same instance after disable. A shutdown
        # executor cannot accept new range writes; recreate it on enable.
        if self._binding_writer is None:
            self._binding_writer = ThreadPoolExecutor(
                max_workers=1, thread_name_prefix="SleepyBindings"
            )
        self._install_performance_monitor()
        self.save_default_config()
        self._load_settings()
        self._load_bindings()
        self.register_events(MumbleHostListener(self))

        if self._state_sink is not None:
            self._state_sink.start()
        if self._host is not None:
            self._host.start()

        self.server.scheduler.run_task(
            self,
            self._tracking_tick,
            delay=0,
            period=self._interval_ticks,
        )
        self.logger.info(
            f"MumbleHost Unified v{self.version} enabled; "
            f"mumble_port={self._mumble_port} "
            f"tracking={self._interval_ticks} ticks "
            f"default_range={self._default_range} "
            f"max_range={self._max_range} "
            f"attenuation={self._default_attenuation_level}"
        )
        self.logger.info(
            "Unified MCSV mode: Item Mic state goes directly to local proximity feed; "
            "no Android/mobile bridge is used."
        )
        self.logger.info(f"Enabled mumble_host v{self.version}")

    def on_disable(self) -> None:
        try:
            self.server.scheduler.cancel_tasks(self)
        except Exception:
            pass
        writer = self._binding_writer
        self._binding_writer = None
        if writer is not None:
            try:
                # Drain the small ordered binding queue before another
                # instance/re-enable can replace bindings.json.
                writer.shutdown(wait=True, cancel_futures=False)
            except Exception as exc:
                self.logger.warning(f"Could not finish binding writer: {exc}")

        sink = self._state_sink
        self._state_sink = None
        if sink is not None:
            sink.stop()

        host = self._host
        self._host = None
        if host is not None:
            host.stop()

        self._save_bindings()
        self._states.clear()
        self._calls.clear()
        self.logger.info("MumbleHost Unified disabled")

    def _load_settings(self) -> None:
        tracking = self.config.get("tracking", {})
        mumble = self.config.get("mumble", {})
        local_state = self.config.get("local_state", {})
        voice = self.config.get("voice", {})

        self._interval_ticks = self._bounded_int(
            tracking.get("interval_ticks", 2), 1, 20, 2
        )
        self._position_epsilon = self._bounded_float(
            tracking.get("position_epsilon", 0.05), 0.001, 10.0, 0.05
        )
        self._rotation_epsilon = self._bounded_float(
            tracking.get("rotation_epsilon", 1.0), 0.01, 180.0, 1.0
        )
        heartbeat_seconds = self._bounded_int(
            tracking.get("heartbeat_seconds", 15), 2, 3600, 15
        )
        self._heartbeat_ticks = heartbeat_seconds * 20

        self._default_range = self._bounded_int(
            voice.get("default_range", 30), 1, 1000, 30
        )
        self._max_range = self._bounded_int(
            voice.get("max_range", 150),
            self._default_range,
            1000,
            150,
        )
        self._default_attenuation_level = self._bounded_int(
            voice.get("default_attenuation_level", 3), 0, 4, 3
        )

        self._mumble_port = self._bounded_int(
            mumble.get("port", 18655), 1, 65535, 18655
        )
        self._mumble_users = self._bounded_int(
            mumble.get("users", 20), 1, 500, 20
        )

        state_host = str(local_state.get("host", "127.0.0.1")).strip()
        if state_host not in {"127.0.0.1", "localhost"}:
            self.logger.warning(
                "local_state.host forced to 127.0.0.1 in unified mode"
            )
            state_host = "127.0.0.1"

        state_port = self._bounded_int(
            local_state.get("port", 47855), 1, 65535, 47855
        )
        max_queue = self._bounded_int(
            local_state.get("max_queue", 4096), 128, 65536, 4096
        )

        self._host = MumbleRuntimeHost(
            self.logger,
            self.data_folder,
            port=self._mumble_port,
            users=self._mumble_users,
        )
        self._state_sink = LocalStateSink(
            self.logger,
            host=state_host,
            port=state_port,
            max_queue=max_queue,
        )

    def _load_bindings(self) -> None:
        path = self.data_folder / "bindings.json"
        if not path.is_file():
            self._bindings = {}
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            self._bindings = data if isinstance(data, dict) else {}
            changed = False
            for key, raw in list(self._bindings.items()):
                if not isinstance(raw, dict):
                    self._bindings.pop(key, None)
                    changed = True
                    continue
                binding = dict(raw)
                if "mumble_name" in binding:
                    binding.pop("mumble_name", None)
                    changed = True
                if "attenuation_level" in binding:
                    binding.pop("attenuation_level", None)
                    changed = True
                if binding:
                    self._bindings[key] = binding
                else:
                    self._bindings.pop(key, None)
            if changed:
                self._save_bindings()
        except Exception as exc:
            self._bindings = {}
            self.logger.warning(
                f"Could not load bindings.json: {type(exc).__name__}: {exc}"
            )

    def _save_bindings(self) -> None:
        # Snapshot while on main thread; write asynchronously in commit order.
        payload = json.dumps(self._bindings, ensure_ascii=False, indent=2)
        path = self.data_folder / "bindings.json"
        writer = self._binding_writer
        if writer is None:
            self.logger.warning("Binding update ignored: plugin is disabled")
            return
        try:
            writer.submit(self._write_bindings_file, path, payload)
        except RuntimeError as exc:
            self.logger.warning(f"Could not queue range storage update: {exc}")

    def _write_bindings_file(self, path: Any, payload: str) -> None:
        try:
            temporary = path.with_suffix(".json.tmp")
            temporary.write_text(payload, encoding="utf-8")
            os.replace(temporary, path)
        except Exception as exc:
            self.logger.warning(f"Could not save bindings.json: {type(exc).__name__}: {exc}")

    def on_command(
        self,
        sender: CommandSender,
        command: Command,
        args: list[str],
    ) -> bool:
        if command.name != "vcb":
            return False
        if args and args[0].lower() == "perf":
            if isinstance(sender, Player) and not sender.has_permission("mumble_host.command.admin"):
                sender.send_error_message("You do not have permission.")
                return True
            for line in self._performance_lines():
                sender.send_message(line)
            return True
        if isinstance(sender, Player):
            self._show_main_menu(sender)
        else:
            sender.send_message(
                f"MumbleHost Unified v{self.version}: "
                f"host={self._host_state_label()}, "
                f"port={self._mumble_port}, tracked={len(self._states)}, "
                f"attenuation={self._default_attenuation_level}"
            )
        return True

    def _install_performance_monitor(self) -> None:
        # Install once: Endstone can disable and re-enable the same instance.
        self._perf_stats = {}
        self._perf_started = time.perf_counter()
        self._perf_last_log = self._perf_started
        if getattr(self, "_perf_installed", False):
            return
        self._perf_installed = True
        for method, label in (
            ("_process_addon_controls", "range_controls"),
            ("_snapshot_if_valid", "player_snapshot"),
            ("_sync_call_sessions", "phone_calls"),
            ("_tracking_tick", "tracking_total"),
        ):
            original = getattr(self, method)
            def measured(*args, _original=original, _label=label, **kwargs):
                wall_start = time.perf_counter()
                cpu_start = time.thread_time()
                try:
                    return _original(*args, **kwargs)
                finally:
                    cpu_ms = (time.thread_time() - cpu_start) * 1000.0
                    wall_ms = (time.perf_counter() - wall_start) * 1000.0
                    row = self._perf_stats.setdefault(_label, [0, 0.0, 0.0, 0.0])
                    row[0] += 1
                    row[1] += cpu_ms
                    row[2] += wall_ms
                    row[3] = max(row[3], wall_ms)
                    if _label == "tracking_total" and time.perf_counter() - self._perf_last_log >= 30:
                        for line in self._performance_lines():
                            self.logger.info(line)
                        self._perf_stats.clear()
                        self._perf_started = time.perf_counter()
                        self._perf_last_log = self._perf_started
            setattr(self, method, measured)

    def _performance_lines(self) -> list[str]:
        window = max(0.001, time.perf_counter() - self._perf_started)
        lines = [f"VC_PERF window_s={window:.1f} scope=MumbleHost-main-thread cpu=thread-time wall=elapsed"]
        # tracking_total contains the subcategories; do not sum it with them.
        rows = sorted(
            ((name, row) for name, row in self._perf_stats.items() if name != "tracking_total"),
            key=lambda entry: entry[1][1], reverse=True,
        )
        if "tracking_total" in self._perf_stats:
            rows.append(("tracking_total", self._perf_stats["tracking_total"]))
        for name, (count, cpu_ms, wall_ms, max_ms) in rows:
            lines.append(
                f"VC_PERF part={name} calls={count} cpu_ms={cpu_ms:.3f} "
                f"wall_ms={wall_ms:.3f} avg_wall_ms={wall_ms / max(1, count):.3f} "
                f"max_wall_ms={max_ms:.3f} one_core_pct={cpu_ms / (window * 10):.3f}"
            )
        return lines

    def _host_state_label(self) -> str:
        host = self._host
        return host.status_line() if host is not None else "offline"

    def _show_main_menu(self, player: Player) -> None:
        key = self._player_key(player)
        binding = self._bindings.get(key, {})
        voice_range = int(binding.get("range") or self._default_range)
        mic = "ON" if self._voice_enabled_for(player) else "OFF"

        form = ActionForm(
            title="MumbleHost • MCSV",
            content=(
                f"Mumble Host: {self._host_state_label()}\n"
                f"Mumble Port: {self._mumble_port}\n"
                f"Mumble Username: {player.name}\n"
                f"Mic: {mic}\n"
                f"Voice Range: {voice_range} blocks\n"
                f"Distance Volume: "
                f"{ATTENUATION_LEVELS[self._default_attenuation_level]} "
                f"(level {self._default_attenuation_level})\n"
                f"Tracked: {len(self._states)}"
            ),
        )
        form.add_button("ซิงก์ข้อมูลของฉัน", on_click=self._sync_player_from_ui)
        if player.has_permission("mumble_host.command.admin"):
            form.add_button(
                "รีสตาร์ท Mumble Host",
                on_click=self._restart_host_from_ui,
            )
        player.send_form(form)

    def _sync_player_from_ui(self, player: Player) -> None:
        self._publish_addon_range_tags(player)
        self._publish_addon_attenuation_tags(player)
        self._broadcast_current_player(player)
        player.send_message("MumbleHost: synced Item Mic state.")
        self._show_main_menu(player)

    def _restart_host_from_ui(self, player: Player) -> None:
        if not player.has_permission("mumble_host.command.admin"):
            player.send_error_message("You do not have permission.")
            return
        host = self._host
        if host is None:
            player.send_error_message("Mumble host is unavailable.")
            return
        self._last_host_running = False
        threading.Thread(
            target=host.restart,
            name="MumbleHost-Restart",
            daemon=True,
        ).start()
        player.send_message("MumbleHost: restarting local Mumble server.")
        self._show_main_menu(player)

    def handle_player_join(self, player: Player) -> None:
        self._publish_addon_range_tags(player)
        self._publish_addon_attenuation_tags(player)
        state = self._snapshot_if_valid(player)
        if state is None:
            return
        self._states[self._player_key(player)] = state
        self._send_state(state)

    def handle_player_quit(self, player: Player) -> None:
        key = self._player_key(player)
        state = self._states.pop(key, None)
        name = state.name if state is not None else str(player.name)
        self._state_send({
            "type": "player_leave",
            "name": name,
            "xuid": str(player.xuid or ""),
            "uuid": str(player.unique_id),
            "mumbleName": name,
        })

    def _tracking_tick(self) -> None:
        tick_started = time.perf_counter()
        current_keys: set[str] = set()

        for player in self.server.online_players:
            key = self._player_key(player)
            current_keys.add(key)

            addon_changed = self._process_addon_controls(player)
            state = self._snapshot_if_valid(player)
            if state is None:
                # Never keep routing with a previously ON cached state when
                # Minecraft can no longer provide a valid fresh snapshot.
                previous = self._states.pop(key, None)
                if previous is not None:
                    self._state_send({
                        "type": "player_leave",
                        "name": previous.name,
                        "xuid": previous.xuid,
                        "uuid": previous.uuid,
                        "mumbleName": previous.name,
                    })
                    self.logger.warning(
                        f"STATE_INVALID player={player.name} action=fail-closed"
                    )
                continue

            previous = self._states.get(key)
            if previous is None or state.voice_enabled != previous.voice_enabled:
                self.logger.info(
                    f"MIC_STATE player={state.name} "
                    f"endstone={'ON' if state.voice_enabled else 'OFF'}"
                )
            if (
                addon_changed
                or previous is None
                or state.changed_from(
                    previous,
                    self._position_epsilon,
                    self._rotation_epsilon,
                )
            ):
                self._states[key] = state
                self._send_state(state)

        for stale_key in set(self._states).difference(current_keys):
            stale = self._states.pop(stale_key)
            self._state_send({
                "type": "player_leave",
                "name": stale.name,
                "xuid": stale.xuid,
                "uuid": stale.uuid,
                "mumbleName": stale.name,
            })

        self._sync_call_sessions()

        host_running = self._host.running if self._host is not None else False
        if host_running and not self._last_host_running:
            self._send_full_snapshot()
            self.logger.info(
                f"Local proximity state synced; tracked={len(self._states)}"
            )
        self._last_host_running = host_running

        self._heartbeat_accumulator += self._interval_ticks
        if self._heartbeat_accumulator >= self._heartbeat_ticks:
            self._heartbeat_accumulator = 0
            self._state_send({
                "type": "heartbeat",
                "online": len(current_keys),
                "tracked": len(self._states),
                "ts": int(time.time() * 1000),
            })
        elapsed_ms = (time.perf_counter() - tick_started) * 1000.0
        if elapsed_ms > 35.0:
            self.logger.warning(
                f"TRACKING_SLOW duration_ms={elapsed_ms:.2f} "
                f"players={len(current_keys)} calls={len(self._calls)}"
            )

    def _send_full_snapshot(self) -> None:
        self._state_send({"type": "sync_begin", "count": len(self._states)})
        for key, state in self._states.items():
            self._state_send(self._state_message(key, state))
        for call in self._calls.values():
            self._state_send(call)
        self._state_send({"type": "sync_end", "count": len(self._states)})

    def _collect_call_sessions(self) -> dict[str, dict[str, Any]]:
        prefix = "vcmumble.call.active."
        pending: dict[str, dict[str, tuple[str, bool]]] = {}

        for player in self.server.online_players:
            try:
                tags = list(player.scoreboard_tags)
            except Exception:
                continue

            for tag in tags:
                if not tag.startswith(prefix):
                    continue
                payload = tag[len(prefix):]
                parts = payload.rsplit(".", 2)
                if len(parts) != 3:
                    continue
                call_id, role, speaker_raw = parts
                call_id = call_id.strip()
                role = role.strip().lower()
                if not call_id or role not in {"a", "b"}:
                    continue
                speaker = speaker_raw.strip() == "1"
                pending.setdefault(call_id, {})[role] = (str(player.name), speaker)

        sessions: dict[str, dict[str, Any]] = {}
        for call_id, roles in pending.items():
            party_a = roles.get("a")
            party_b = roles.get("b")
            if party_a is None or party_b is None:
                continue
            if party_a[0].casefold() == party_b[0].casefold():
                continue
            sessions[call_id] = {
                "type": "call_state",
                "callId": call_id,
                "partyA": party_a[0],
                "partyB": party_b[0],
                "speakerA": bool(party_a[1]),
                "speakerB": bool(party_b[1]),
            }
        return sessions

    def _sync_call_sessions(self) -> None:
        current = self._collect_call_sessions()

        for call_id, payload in current.items():
            previous = self._calls.get(call_id)
            if previous != payload:
                self._state_send(payload)

        for call_id in set(self._calls).difference(current):
            self._state_send({
                "type": "call_end",
                "callId": call_id,
            })

        self._calls = current

    def _broadcast_current_player(self, player: Player) -> None:
        state = self._snapshot_if_valid(player)
        if state is None:
            return
        key = self._player_key(player)
        self._states[key] = state
        self._send_state(state)

    def _send_state(self, state: PlayerState) -> None:
        key = state.xuid if state.xuid else state.uuid
        self._state_send(self._state_message(key, state))

    def _state_message(
        self,
        key: str,
        state: PlayerState,
    ) -> dict[str, Any]:
        binding = self._bindings.get(key, {})
        return {
            "type": "player_state",
            "name": state.name,
            "xuid": state.xuid,
            "uuid": state.uuid,
            "mumbleName": state.name,
            "dimension": state.dimension,
            "x": state.x,
            "y": state.y,
            "z": state.z,
            "yaw": state.yaw,
            "pitch": state.pitch,
            "voiceRange": int(binding.get("range") or self._default_range),
            "voiceEnabled": bool(state.voice_enabled),
            "attenuationLevel": self._default_attenuation_level,
        }

    def _state_send(self, message: dict[str, Any]) -> bool:
        sink = self._state_sink
        return sink.send(message) if sink is not None else False

    @staticmethod
    def _player_key(player: Player) -> str:
        return str(player.xuid or "") or str(player.unique_id)

    def _snapshot_if_valid(self, player: Player) -> PlayerState | None:
        try:
            loc = player.location
            state = PlayerState(
                name=str(player.name),
                xuid=str(player.xuid or ""),
                uuid=str(player.unique_id),
                dimension=str(player.dimension.name),
                x=float(loc.x),
                y=float(loc.y),
                z=float(loc.z),
                yaw=float(loc.yaw),
                pitch=float(loc.pitch),
                voice_enabled=self._voice_enabled_for(player),
            )
            values = (state.x, state.y, state.z, state.yaw, state.pitch)
            if not all(math.isfinite(v) for v in values):
                return None
            if state.y < -4096.0 or state.y > 4096.0:
                return None
            if abs(state.x) > 30_000_000 or abs(state.z) > 30_000_000:
                return None
            return state if state.dimension else None
        except Exception:
            return None

    def _process_addon_controls(self, player: Player) -> bool:
        try:
            tags = list(player.scoreboard_tags)
        except Exception:
            return False

        key = self._player_key(player)
        binding = dict(self._bindings.get(key, {}))
        current_range = int(binding.get("range") or self._default_range)
        maximum = 1000 if self._is_operator(player) else self._max_range
        changed = False

        for tag in tags:
            if tag.startswith("vcmumble.vr.sync."):
                request_id = tag[len("vcmumble.vr.sync."):]
                self._remove_player_tag(player, tag)
                self._publish_addon_range_tags(player, current_range, maximum)
                if request_id:
                    self._add_player_tag(
                        player,
                        f"vcmumble.vr.ack.{request_id}.ok.{current_range}",
                    )
                continue

            if tag.startswith("vcmumble.vr.request."):
                payload = tag[len("vcmumble.vr.request."):]
                request_id, separator, raw_value = payload.rpartition(".")
                started_at = time.perf_counter()
                self.logger.info(f"RANGE_BEGIN player={player.name} id={request_id}")
                self._remove_player_tag(player, tag)
                removed_at = time.perf_counter()

                status = "error"
                try:
                    requested = int(raw_value) if separator else 0
                except ValueError:
                    requested = 0

                if request_id and 1 <= requested <= maximum:
                    status = "ok"
                    if requested != current_range:
                        binding["range"] = requested
                        self._bindings[key] = binding
                        self._save_bindings()
                        current_range = requested
                        changed = True

                stored_at = time.perf_counter()
                self._publish_addon_range_tags(player, current_range, maximum)
                published_at = time.perf_counter()
                if request_id:
                    self._add_player_tag(
                        player,
                        f"vcmumble.vr.ack.{request_id}.{status}.{current_range}",
                    )
                done_at = time.perf_counter()
                elapsed_ms = (done_at - started_at) * 1000.0
                self.logger.info(
                    f"RANGE_ACK player={player.name} id={request_id} "
                    f"requested={requested} actual={current_range} "
                    f"status={status} duration_ms={elapsed_ms:.2f} "
                    f"remove_ms={(removed_at-started_at)*1000:.2f} "
                    f"parse_store_ms={(stored_at-removed_at)*1000:.2f} "
                    f"publish_ms={(published_at-stored_at)*1000:.2f} "
                    f"ack_ms={(done_at-published_at)*1000:.2f}"
                )
                if elapsed_ms > 35.0:
                    self.logger.warning(f"RANGE_SLOW duration_ms={elapsed_ms:.2f}")
                continue

            if tag.startswith("vcmumble.attn.sync."):
                request_id = tag[len("vcmumble.attn.sync."):]
                self._remove_player_tag(player, tag)
                self._publish_addon_attenuation_tags(player)
                if request_id:
                    self._add_player_tag(
                        player,
                        f"vcmumble.attn.ack.{request_id}.ok."
                        f"{self._default_attenuation_level}",
                    )
                continue

            if tag.startswith("vcmumble.attn.request."):
                payload = tag[len("vcmumble.attn.request."):]
                request_id, _, _ = payload.rpartition(".")
                self._remove_player_tag(player, tag)
                self._publish_addon_attenuation_tags(player)
                if request_id:
                    self._add_player_tag(
                        player,
                        f"vcmumble.attn.ack.{request_id}.ok."
                        f"{self._default_attenuation_level}",
                    )

        return changed

    def _publish_addon_range_tags(
        self,
        player: Player,
        current_range: int | None = None,
        maximum: int | None = None,
    ) -> None:
        key = self._player_key(player)
        binding = self._bindings.get(key, {})
        value = int(current_range or binding.get("range") or self._default_range)
        max_value = int(
            maximum or (1000 if self._is_operator(player) else self._max_range)
        )
        self._replace_player_tag_prefix(
            player,
            "vcmumble.vr.value.",
            f"vcmumble.vr.value.{value}",
        )
        self._replace_player_tag_prefix(
            player,
            "vcmumble.vr.max.",
            f"vcmumble.vr.max.{max_value}",
        )

    def _publish_addon_attenuation_tags(self, player: Player) -> None:
        self._replace_player_tag_prefix(
            player,
            "vcmumble.attn.value.",
            f"vcmumble.attn.value.{self._default_attenuation_level}",
        )

    @staticmethod
    def _replace_player_tag_prefix(
        player: Player,
        prefix: str,
        replacement: str,
    ) -> None:
        try:
            tags = set(player.scoreboard_tags)
            for tag in tags:
                if tag.startswith(prefix) and tag != replacement:
                    player.remove_scoreboard_tag(tag)
            if replacement not in set(player.scoreboard_tags):
                player.add_scoreboard_tag(replacement)
        except Exception:
            pass

    @staticmethod
    def _add_player_tag(player: Player, tag: str) -> None:
        try:
            player.add_scoreboard_tag(tag)
        except Exception:
            pass

    @staticmethod
    def _remove_player_tag(player: Player, tag: str) -> None:
        try:
            player.remove_scoreboard_tag(tag)
        except Exception:
            pass

    @staticmethod
    def _is_operator(player: Player) -> bool:
        try:
            return bool(player.is_op)
        except Exception:
            return False

    @staticmethod
    def _voice_enabled_for(player: Player) -> bool:
        try:
            tags = set(player.scoreboard_tags)
            # Fail closed: OFF wins even if stale ON is still present.
            if "vcmumble.mic.off" in tags:
                return False
            return "vcmumble.mic.on" in tags
        except Exception:
            return False

    @staticmethod
    def _bounded_int(
        value: Any,
        minimum: int,
        maximum: int,
        fallback: int,
    ) -> int:
        try:
            return max(minimum, min(maximum, int(value)))
        except (TypeError, ValueError):
            return fallback

    @staticmethod
    def _bounded_float(
        value: Any,
        minimum: float,
        maximum: float,
        fallback: float,
    ) -> float:
        try:
            return max(minimum, min(maximum, float(value)))
        except (TypeError, ValueError):
            return fallback
