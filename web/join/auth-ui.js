(async()=>{
 const panel=document.getElementById('account');if(!panel)return;
 const button=panel.querySelector('a');const identity=panel.querySelector('.account-user');const out=panel.querySelector('button');const notice=document.getElementById('auth-notice');
 button.href='/api/auth/discord/login?returnTo='+encodeURIComponent(location.pathname+location.hash);
 const errors={unavailable:'ระบบเข้าสู่ระบบยังไม่พร้อม กรุณาลองอีกครั้งภายหลัง',cancelled:'ยกเลิกการเข้าสู่ระบบแล้ว',failed:'เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง'};
 const reason=new URLSearchParams(location.search).get('auth');if(errors[reason]){notice.textContent=errors[reason];notice.hidden=false;history.replaceState(null,'',location.pathname+location.hash);}
 try{
  const response=await fetch('/api/auth/session',{cache:'no-store'});if(!response.ok)throw Error();const data=await response.json();
  if(data.user){button.hidden=true;identity.textContent=data.user.name;identity.hidden=false;out.hidden=false;}
  else if(!data.configured){button.setAttribute('aria-disabled','true');button.addEventListener('click',e=>{e.preventDefault();notice.textContent=errors.unavailable;notice.hidden=false;});}
 }catch{button.addEventListener('click',e=>{e.preventDefault();notice.textContent='ตรวจสอบการเข้าสู่ระบบไม่ได้ กรุณารีเฟรชหน้า';notice.hidden=false;});}
 out.addEventListener('click',async()=>{out.disabled=true;try{const r=await fetch('/api/auth/logout',{method:'POST'});if(!r.ok)throw Error();location.reload();}catch{out.disabled=false;notice.textContent='ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง';notice.hidden=false;}});
})();
