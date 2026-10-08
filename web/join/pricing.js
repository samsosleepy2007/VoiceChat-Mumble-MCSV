// Shows the install price from the payment configuration, so the page never drifts from checkout.
(()=>{
 const format=satang=>(satang/100).toLocaleString('th-TH',{maximumFractionDigits:2});
 fetch('/api/payments/availability',{credentials:'same-origin'}).then(r=>r.ok?r.json():null).then(c=>{
  if(!c||!Number.isSafeInteger(c.amountSatang)||c.amountSatang<=0)return;
  for(const node of document.querySelectorAll('[data-price]'))node.textContent=format(c.amountSatang);
  const methods=[c.promptpay&&'PromptPay',c.truemoney&&'TrueMoney'].filter(Boolean).join(' / ');
  for(const node of document.querySelectorAll('[data-price-methods]'))node.textContent=methods?'ชำระด้วย '+methods:'';
  for(const node of document.querySelectorAll('[data-pricing]'))node.hidden=false;
 }).catch(()=>{});
})();
