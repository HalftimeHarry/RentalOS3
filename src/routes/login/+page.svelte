<script lang="ts">
  import { goto } from '$app/navigation';
  import { Building2, LockKeyhole, Mail, ArrowRight } from '@lucide/svelte';
  import { authService } from '$lib/services/AuthService';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);

  async function login() {
    loading = true; error = '';
    try { await authService.login(email, password); goto('/dashboard'); }
    catch { error = 'We could not sign you in. Check your email and password.'; }
    finally { loading = false; }
  }
</script>

<svelte:head><title>Sign in · RentalOS3</title></svelte:head>
<div class="login-page">
  <div class="login-panel">
    <div class="login-logo"><span class="brand-mark"><Building2 size={19} /></span><span>Rental<span class="brand-accent">OS3</span></span></div>
    <p class="page-kicker">Property management</p>
    <h1>Welcome back.</h1>
    <p class="muted">Sign in to keep your rental running smoothly.</p>
    <form onsubmit={(event) => { event.preventDefault(); login(); }}>
      <label>Email <span class="input-wrap"><Mail size={16} /><input bind:value={email} type="email" placeholder="you@example.com" required /></span></label>
      <label>Password <span class="input-wrap"><LockKeyhole size={16} /><input bind:value={password} type="password" placeholder="Your password" required /></span></label>
      {#if error}<p class="form-error">{error}</p>{/if}
      <button class="button login-button" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'} <ArrowRight size={17} /></button>
    </form>
    <p class="register-prompt">Need an account? <a href="/register">Create one</a></p>
  </div>
</div>

<style>
  .login-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at 80% 10%, #d6e9c8, transparent 36%), #183b35; }
  .login-panel { width: min(100%, 430px); padding: 42px; border-radius: 12px; background: #fff; box-shadow: 0 18px 60px #0d2b264d; }
  .login-logo { display: flex; gap: 10px; align-items: center; margin-bottom: 58px; font: 700 18px 'Space Grotesk'; }.brand-mark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; color: #183b35; background: #b6e477; }.brand-accent { color: #5d8a36; }
  h1 { margin: 0 0 8px; font: 700 38px 'Space Grotesk'; letter-spacing: -.04em; }.muted { color: #71837c; } form { display: grid; gap: 17px; margin-top: 34px; } label { display: grid; gap: 7px; color: #344d44; font-size: 13px; font-weight: 600; }.input-wrap { display: flex; align-items: center; gap: 9px; padding: 0 12px; border: 1px solid #d8e3d8; border-radius: 7px; color: #789087; background: #fbfdfb; }.input-wrap:focus-within { border-color: #88ad78; box-shadow: 0 0 0 3px #dcebd5; } input { width: 100%; border: 0; outline: 0; padding: 13px 0; color: #17231f; background: transparent; }.form-error { margin: 0; color: #a14c3b; font-size: 13px; }.login-button { justify-content: center; width: 100%; margin-top: 8px; }.register-prompt { margin: 24px 0 0; color: #71837c; font-size: 13px; text-align: center; }.register-prompt a { color: #356c4f; font-weight: 700; }.button:disabled { opacity: .6; cursor: wait; }
  @media (max-width: 480px) { .login-panel { padding: 30px 24px; }.login-logo { margin-bottom: 42px; } }
</style>
