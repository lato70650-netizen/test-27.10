const status = document.querySelector('#status');
const token = location.hash.slice(1);
history.replaceState(null, '', '/join');
if (!/^[A-Za-z0-9_-]{43}$/.test(token)) status.textContent = 'Ссылка недействительна. Попросите владельца прислать новую.';
else {
  fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
    .then(response => { if (!response.ok) throw new Error(); location.replace('/'); })
    .catch(() => { status.textContent = 'Ссылка недействительна, уже использована или срок её действия истёк. Попросите владельца прислать новую.'; });
}
