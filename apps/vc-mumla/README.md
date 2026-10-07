# SleepyMumla Android

แอป Android สำหรับใช้ voice chat ควบคู่กับ Minecraft Bedrock และระบบ MumbleHost ของโครงการ ปรับจาก Mumla/Humla ให้รองรับเสียงตามระยะและการเปิดแอปจากหน้า Join

## ดาวน์โหลดและการใช้งาน

ดาวน์โหลดแอปจาก [เว็บไซต์ SleepyMumla](https://sleepyvoice-join.vercel.app/) หรือ [Releases ของโครงการ](https://github.com/samsosleepy2007/VoiceChat-Mumble-MCSV/releases)

รุ่นปัจจุบันคือ **0.6.3** ใช้ชื่อ Xbox ที่ตรงกับชื่อ Minecraft เพื่อเชื่อมเสียงกับตัวละคร:

- เปิดจากลิงก์ `mumble://ชื่อXbox@โดเมน:พอร์ตเสียง/` ได้ทั้งตอนเปิดแอปใหม่และตอนแอปทำงานอยู่
- รองรับลิงก์ที่ไม่มีรหัสผ่าน โดยไม่ส่ง `null` ให้ Protobuf
- รองรับชื่อ Xbox และรหัสผ่านที่เข้ารหัส URL
- ใช้ Android system echo cancellation ตามการตั้งค่าเสียง
- ในโหมดเสียงปกติ เลือกลำโพงหลักเมื่อไม่มีหูฟัง และเลือกอุปกรณ์ภายนอกที่รองรับเมื่อเชื่อมต่อ
- คืนการเลือกอุปกรณ์เสียงเมื่อออกจากเซิร์ฟเวอร์ โหมด Handset และ Bluetooth SCO เดิมยังมีเส้นทางการทำงานของตนเอง

APK ปัจจุบันเป็น debug build ลายเซ็นแต่ละรุ่นอาจต่างกัน หากติดตั้งทับไม่ได้ ต้องถอนรุ่นเดิมก่อน ข้อมูลแอปเดิมจะถูกล้าง ควรเก็บข้อมูลเซิร์ฟเวอร์และ export ใบรับรองผู้ใช้ที่จำเป็นก่อนถอน

ตรวจความถูกต้องของไฟล์ด้วยรายการ SHA-256 ที่แนบมากับ Release นั้น ไม่ใช้ checksum ของ APK เก่าในโฟลเดอร์ `apk/` แทน

## ซอร์สและที่มา

- [ซอร์สแอปรุ่นปัจจุบันบน main](https://github.com/samsosleepy2007/VoiceChat-Mumble-MCSV/tree/main/apps/vc-mumla/source)
- [Provenance ของ upstream และรุ่นตั้งต้น](PROVENANCE.json)
- [สคริปต์ปรับแต่ง VC เดิม](scripts/patch-mumla-vc-client.py)

`PROVENANCE.json` บันทึกฐานที่นำมาพัฒนาต่อ ส่วนไฟล์ APK เก่าใน `apk/` เก็บไว้เป็นรุ่นเดิม ให้ใช้เว็บไซต์หรือ Releases สำหรับรุ่นใหม่

## Build

ใช้ **Java 21, Android SDK 36, Build Tools 36.0.0 และ NDK 25.1.8937393** และ checkout สาขา `main` ก่อน

```sh
# เริ่มจาก root ของ repository
git switch main
cd apps/vc-mumla/source/libraries/humla/libs/humla-spongycastle
chmod +x ../../gradlew
../../gradlew jar --no-daemon
cd ../../../..
chmod +x gradlew
./gradlew :libraries:humla:testDebugUnitTest :app:assembleBetaDebug --stacktrace --no-daemon
```

ไฟล์ APK จะอยู่ใน `app/build/outputs/apk/beta/debug/` การ build โดยตรงใช้ application ID ของ beta ตามซอร์ส ส่วน workflow `release-sleepymumla-webjoin-fix.yml` เปลี่ยน application ID เป็น `se.lublin.mumla.webjoin` และกำหนดหมายเลขรุ่นก่อนสร้าง APK ที่เผยแพร่บนเว็บ

การทดสอบประกอบด้วย URL parser, ชื่อ Xbox/รหัสผ่านที่เข้ารหัส และการเลือกอุปกรณ์เสียง: ลำโพงหลัก หูฟังสาย USB และ Bluetooth การยืนยันเสียงจริงยังต้องทดสอบบนอุปกรณ์ Android

สำหรับภาพรวมเซิร์ฟเวอร์ แอดออน เว็บไซต์ และวิธีติดตั้ง ดู [README หลัก](../../README.md) รักษาใบอนุญาตของ upstream และไลบรารีไว้พร้อมซอร์ส
