(() => {
  const header=document.querySelector('.admin-site-header');
  if(!header)return;
  const toggle=header.querySelector('.admin-site-toggle'),links=header.querySelector('.admin-site-links');
  const setOpen=open=>{links.classList.toggle('is-open',open);toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Lukk meny':'Åpne meny');};
  toggle.addEventListener('click',()=>setOpen(toggle.getAttribute('aria-expanded')!=='true'));
  header.addEventListener('keydown',event=>{if(event.key==='Escape'&&toggle.getAttribute('aria-expanded')==='true'){setOpen(false);toggle.focus();}});
  links.addEventListener('click',event=>{if(event.target.closest('a'))setOpen(false);});
  document.addEventListener('click',event=>{if(!header.contains(event.target))setOpen(false);});
  matchMedia('(max-width:1000px)').addEventListener('change',()=>setOpen(false));
  header.querySelector('.admin-site-logout').addEventListener('click',()=>{if(confirm('Vil du logge ut fra admin?')){localStorage.removeItem('adminLoggedIn');location.href='admin.html';}});
})();
