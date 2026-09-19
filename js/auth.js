const authMsg = document.getElementById('auth-msg');

async function checkSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    showApp();
  } else {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('login-screen').classList.add('active');
  document.getElementById('app-screen').classList.remove('active');
}

function showApp() {
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('app-screen').classList.add('active');
  caricaLavori();
  inizializzaForm();
}

document.getElementById('btn-login').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  authMsg.textContent = '';
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    authMsg.textContent = 'Errore: ' + error.message;
  } else {
    showApp();
  }
});

document.getElementById('btn-signup').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  authMsg.textContent = '';
  const { error } = await supabaseClient.auth.signUp({ email, password });
  if (error) {
    authMsg.textContent = 'Errore: ' + error.message;
  } else {
    authMsg.classList.add('ok');
    authMsg.textContent = 'Registrazione inviata. Controlla la mail o accedi direttamente.';
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  showLogin();
});

checkSession();