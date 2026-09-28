# VoiceChat-Mumble-MCSV

**One-file Endstone plugin** สำหรับเปิด Mumble Server และทำ Minecraft Bedrock proximity voice บน MCSV โดยตรง

## v0.4.0 experimental topology

```text
Item Mic Addon
    |
    v
MumbleHost Endstone v0.4.0
    |
    +-- Mic ON/OFF
    +-- Voice Range
    +-- Player XYZ + Dimension
    +-- attenuation level 3
    |
    v
127.0.0.1:47855 UDP
    |
    v
mumble-server-vc :18655
```

ไม่ใช้ Android/mobile bridge, shared secret หรือ plugin VC Mumble Endstone แยกอีกตัว

## Features

- เปิด Mumble Server 1.6.870 บน MCSV อัตโนมัติ
- ใช้ custom `mumble-server-vc` ที่มี proximity routing patch
- Mic ON/OFF จาก Item Mic tags
- Voice Range จาก Item Mic request/ACK contract
- แยกเสียงตาม Minecraft dimension
- ตัดเสียงเมื่อเกิน Voice Range
- smooth distance attenuation ค่าเริ่มต้น level 3
- ใช้ชื่อ Minecraft เป็น Mumble username
- local state feed เป็น localhost-only
- `/vcb` แสดงสถานะ Mumble/Range/Mic และมีปุ่ม restart host สำหรับ Operator

## Welcome text

```text
Hosted by MCSV
Plugin Mumble connate by SamSoSleepy
Discord : https://discord.gg/FnmWw7nWyq
```

## Default ports

- Mumble: `18655` TCP/UDP
- Local proximity state: `127.0.0.1:47855` UDP

## Item Mic contract

Addon ใช้ tags เดิม:

- `vcmumble.mic.on`
- `vcmumble.mic.off`
- `vcmumble.vr.request.*`
- `vcmumble.vr.sync.*`
- `vcmumble.vr.value.*`
- `vcmumble.vr.max.*`
- `vcmumble.vr.ack.*`

ดังนั้น Item Mic ไม่ต้องมี Android bridge หรือ secret ใด ๆ

## Config

```toml
[tracking]
interval_ticks = 2
position_epsilon = 0.05
rotation_epsilon = 1.0
heartbeat_seconds = 15

[mumble]
port = 18655
users = 20

[local_state]
host = "127.0.0.1"
port = 47855
max_queue = 4096

[voice]
default_range = 30
max_range = 150
default_attenuation_level = 3
```

## Current experimental branch

`experiment/unified-itemmic-proximity-v0.4.0`

ยังไม่ merge เข้า `main` จนกว่าจะทดสอบกับผู้เล่นจริงครบ Mic ON/OFF, Range, distance attenuation และ DDUI.
