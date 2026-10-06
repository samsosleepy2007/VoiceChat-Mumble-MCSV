(async()=>{
 const panel=document.getElementById('account');if(!panel)return;
 const button=panel.querySelector('a');const identity=panel.querySelector('.account-user');const out=panel.querySelector('button');const notice=document.getElementById('auth-notice');
 button.href='/api/auth/discord/login?returnTo='+encodeURIComponent(location.pathname+location.hash);
 const errors={membership_rate_limit:'Discord จำกัดจำนวนการตรวจสอบ กรุณารอสักครู่แล้วรีเฟรช ไม่ต้องล็อกอินซ้ำ',membership_auth_invalid:'ข้อมูลยืนยันตัวตนของบอทไม่ถูกต้อง กรุณาติดต่อผู้ดูแล',membership_access_denied:'บอทตรวจสมาชิกเซิร์ฟเวอร์ไม่ได้ กรุณาติดต่อผู้ดูแล',unavailable:'ระบบเข้าสู่ระบบยังไม่พร้อม กรุณาลองอีกครั้งภายหลัง',cancelled:'ยกเลิกการเข้าสู่ระบบแล้ว',failed:'เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง',join_unavailable:'ต้องเป็นสมาชิก Discord ของ SleepyMumla ก่อนเข้าสู่ระบบ ขณะนี้ระบบเข้าร่วมอัตโนมัติยังไม่พร้อม',join_failed:'เข้าร่วม Discord ไม่สำเร็จ กรุณาลองอีกครั้งหรือติดต่อผู้ดูแล',screening:'กรุณาเปิดเซิร์ฟเวอร์ Discord และยอมรับกฎให้เรียบร้อย แล้วเข้าสู่ระบบใหม่',membership_required:'คุณต้องเป็นสมาชิก Discord ของ SleepyMumla ก่อน กรุณาเข้าสู่ระบบอีกครั้ง',membership_unavailable:'ตรวจสอบสมาชิก Discord ไม่สำเร็จ กรุณาลองอีกครั้ง'};
 function showReason(reason){notice.textContent=errors[reason]||errors.failed;notice.hidden=false;if(reason==='screening'){const a=document.createElement('a');a.href='https://discord.com/channels/1420339720277463112';a.textContent=' เปิด Discord';a.target='_blank';a.rel='noopener noreferrer';notice.append(a);}}
 const reason=new URLSearchParams(location.search).get('auth');if(errors[reason]){showReason(reason);history.replaceState(null,'',location.pathname+location.hash);}
 try{
  const response=await fetch('/api/auth/session',{cache:'no-store'});const data=await response.json();if(!response.ok){showReason(data.reason||'membership_unavailable');if(data.reference)notice.append(' · รหัสตรวจสอบ '+data.reference);return;}if(data.reason)showReason(data.reason);
  if(data.user){button.hidden=true;identity.textContent=data.user.name;identity.hidden=false;out.hidden=false;}
  else if(!data.configured){button.setAttribute('aria-disabled','true');button.addEventListener('click',e=>{e.preventDefault();notice.textContent=errors.unavailable;notice.hidden=false;});}
 }catch{button.addEventListener('click',e=>{e.preventDefault();notice.textContent='ตรวจสอบการเข้าสู่ระบบไม่ได้ กรุณารีเฟรชหน้า';notice.hidden=false;});}
 out.addEventListener('click',async()=>{out.disabled=true;try{const r=await fetch('/api/auth/logout',{method:'POST'});if(!r.ok)throw Error();location.reload();}catch{out.disabled=false;notice.textContent='ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง';notice.hidden=false;}});
})();
