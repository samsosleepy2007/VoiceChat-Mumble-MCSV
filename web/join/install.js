(()=>{
 const el=id=>document.getElementById(id),dialog=el('guide-dialog');
 document.querySelectorAll('[data-guide]').forEach(button=>button.addEventListener('click',()=>{const api=button.dataset.guide==='api';el('api-guide').hidden=!api;el('reinstall-guide').hidden=api;el('guide-title').textContent=api?'วิธีหา MCSV API Key':'ติดตั้งใหม่เป็น Endstone';dialog.showModal();}));
 el('close-guide').addEventListener('click',()=>dialog.close());
 el('show-key').addEventListener('click',()=>{const show=el('mcsv-key').type==='password';el('mcsv-key').type=show?'text':'password';el('show-key').textContent=show?'ซ่อน':'แสดง';el('show-key').setAttribute('aria-pressed',String(show));el('show-key').setAttribute('aria-label',show?'ซ่อน API Key':'แสดง API Key');});
 const errors={timeout:'MCSV ตอบกลับช้าเกินกำหนด กรุณาลองใหม่',endpoint:'ไม่พบ endpoint ของ MCSV กรุณาติดต่อผู้ดูแล SleepyMumla',rejected:'MCSV ปฏิเสธการตรวจข้อมูล กรุณาตรวจสิทธิ์ Key แล้วลองใหม่',upstream:'บริการ MCSV ตอบกลับผิดพลาด กรุณาลองใหม่ภายหลัง',invalid_response:'MCSV ส่งข้อมูลกลับมาไม่ถูกต้อง กรุณาลองใหม่',auth_check_unavailable:'ตรวจสอบสมาชิก Discord ไม่สำเร็จ กรุณาลองใหม่หรือเข้าสู่ระบบใหม่',format:'รูปแบบคำขอไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่',invalid_key:'API Key ไม่ถูกต้องหรือถูกยกเลิกแล้ว กรุณาสร้าง Key ใหม่จาก MCSV',permission:'Key นี้ไม่มีสิทธิ์อ่านข้อมูลเซิร์ฟเวอร์ แก้สิทธิ์ที่ ระบบ → API / MCP แล้วลองใหม่',installing:'เซิร์ฟเวอร์กำลังติดตั้ง รอให้เสร็จแล้วตรวจอีกครั้ง',rate_limit:'ตรวจสอบถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',unverified:'ยืนยันประเภทเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจข้อมูลใน MCSV แล้วลองใหม่',unavailable:'เชื่อมต่อ MCSV ไม่สำเร็จ กรุณาลองอีกครั้งภายหลัง',auth_unavailable:'ระบบเข้าสู่ระบบยังไม่พร้อม กรุณาลองใหม่ภายหลัง'};
 el('mcsv-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=el('check-server'),result=el('check-result');button.disabled=true;result.hidden=false;result.className='check-result';result.textContent='กำลังตรวจสอบเซิร์ฟเวอร์…';el('reinstall-help').hidden=true;
  try{
   const s=await fetch('/api/auth/session',{cache:'no-store'});const account=await s.json();if(!s.ok)throw Error('auth_unavailable');
   if(!account.user){result.textContent='กรุณาเข้าสู่ระบบด้วย Discord ก่อนตรวจ API Key';return;}
   const response=await fetch('/api/mcsv/check',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({apiKey:el('mcsv-key').value.trim()})});const data=await response.json();
   if(!response.ok){if(data.error==='login_required'){result.textContent='เซสชันหมดอายุหรือยังไม่เป็นสมาชิก Discord กรุณาเข้าสู่ระบบใหม่';return;}const failure=Error(data.error);failure.reference=data.reference;throw failure;}
   if(data.compatible===true){result.classList.add('success');result.textContent='✓ '+data.server.name+' เป็น Minecraft Bedrock · Endstone รองรับระบบไมค์ และพร้อมสำหรับขั้นตอนติดตั้ง';}
   else{result.classList.add('error');result.textContent='เซิร์ฟเวอร์นี้ไม่รองรับ ('+data.server.game+' / '+data.server.serverType+') กรุณาติดตั้งใหม่เป็น Minecraft Bedrock · Endstone';el('reinstall-help').hidden=false;}
  }catch(error){result.classList.add('error');result.textContent=(errors[error.message]||errors.unavailable)+(error.reference?' · รหัสตรวจสอบ '+error.reference:'');}
  finally{button.disabled=false;el('mcsv-key').value='';el('mcsv-key').type='password';el('show-key').textContent='แสดง';el('show-key').setAttribute('aria-pressed','false');el('show-key').setAttribute('aria-label','แสดง API Key');}
 });
})();
