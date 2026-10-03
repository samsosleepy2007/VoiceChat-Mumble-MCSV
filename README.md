# VoiceChat-Mumble-MCSV

**One-file Endstone plugin** สำหรับเปิด Mumble Server และทำ Minecraft Bedrock proximity voice บน MCSV โดยตรง

## Item Mic v2.15.4 — Money items

แอดออน: [VC_Mumble_ItemMic_v2.15.4_Money.mcaddon](release-assets/VC_Mumble_ItemMic_v2.15.4_Money.mcaddon)

ใช้ v2.15.1 ที่อยู่ใน main เป็นฐาน เพิ่มโมเดล, texture และไอเทมเงินจาก Money ทั้ง 6 ค่า โดยใช้ ID ที่มีตัวอักษรนำหน้าค่าเงิน:
`sleepy:money_1`, `sleepy:money_5`, `sleepy:money_10`, `sleepy:money_100`, `sleepy:money_500`, `sleepy:money_1000`.
ไอเทมเงินอยู่หมวด Items ใน Creative inventory และถือมือหลักเท่านั้น (ปิด allow_off_hand และนำ wearable offhand ออก).
ยังไม่มีระบบซื้อขายหรือยอดเงิน ไมค์และ SleepyPhone ใช้ระบบเดิม.

Source BP/RP อยู่ใน `addon/`; สร้างไฟล์ด้วย `python tools/build_itemmic_addon.py`.
ตรวจ JSON, ID/texture references และการปิดมือซ้ายแล้ว; ยังต้องทดสอบการแสดงโมเดลใน Minecraft จริง.

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

### v2.15.4 fixes

Money items use format 1.26.0 with armor/enchantable/durability/repairable removed.
Mic flag reassertion checks getItem before accessing a container slot and handles unloaded slots.
