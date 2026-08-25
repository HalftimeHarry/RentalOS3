<script lang="ts">
  import { goto } from '$app/navigation';
  import { ArrowRight, Building2, LockKeyhole, Mail, UserRound } from '@lucide/svelte';
  import { authService } from '$lib/services/AuthService';

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let error = $state('');
  let loading = $state(false);

  async function register() {
    error = '';
    if (password !== confirmPassword) {
      error = 'Passwords do not match.';
      return;
    }
    loading = true;
    try {
      await authService.register(name, email, password);
      goto('/dashboard');
    } catch (caughtError) {
      const details = (caughtError as { response?: { data?: { message?: string; error?: string } } } | undefined)?.response?.data;
      const fallback = details?.message || details?.error || (caughtError instanceof Error ? caughtError.message : '');
      error = fallback || 'We could not create your account. Check the details and try again.';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head><title>Create account · RentalOS3</title></svelte:head>
<div class="login-page">
  <div class="login-panel">
    <div class="login-logo"><span class="brand-mark"><Building2 size={19} /></span><span>Rental<span class="brand-accent">OS3</span></span></div>
    <p class="page-kicker">Get started</p>
    <h1>Create your account.</h1>
    <p class="muted">Create a renter account to view your home and monthly bills.</p>
    <form onsubmit={(event) => { event.preventDefault(); register(); }}>
      <label>Name <span class="input-wrap"><UserRound size={16} /><input bind:value={name} type="text" placeholder="Your name" required /></span></label>
      <label>Email <span class="input-wrap"><Mail size={16} /><input bind:value={email} type="email" placeholder="you@example.com" required /></span></label>
      <label>Password <span class="input-wrap"><LockKeyhole size={16} /><input bind:value={password} type="password" minlength="8" placeholder="At least 8 characters" required /></span></label>
      <label>Confirm password <span class="input-wrap"><LockKeyhole size={16} /><input bind:value={confirmPassword} type="password" minlength="8" placeholder="Repeat your password" required /></span></label>
      {#if error}<p class="form-error">{error}</p>{/if}
      <button class="button login-button" disabled={loading}>{loading ? 'Creating account...' : 'Create account'} <ArrowRight size={17} /></button>
    </form>
    <p class="register-prompt">Already registered? <a href="/login">Sign in</a></p>
  </div>
</div>

<style>
  .login-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at 80% 10%, #d6e9c8, transparent 36%), #183b35; }
  .login-panel { width: min(100%, 470px); padding: 32px 28px 26px; border-radius: 18px; background: #fff; box-shadow: 0 18px 60px #0d2b264d; }
  .login-logo { display: flex; gap: 10px; align-items: center; margin-bottom: 28px; font: 700 20px 'Space Grotesk'; }
  .brand-mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; color: #183b35; background: #b6e477; }
  .brand-accent { color: #5d8a36; }
  h1 { margin: 0 0 8px; font: 700 38px 'Space Grotesk'; letter-spacing: -.04em; }
  .muted { color: #71837c; margin: 0; }
  form { display: grid; gap: 16px; margin-top: 26px; }
  label { display: grid; gap: 8px; color: #344d44; font-size: 13px; font-weight: 600; }
  .input-wrap { display: flex; align-items: center; gap: 9px; padding: 0 12px; border: 1px solid #d8e3d8; border-radius: 10px; color: #789087; background: #fbfdfb; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
  .input-wrap:focus-within { border-color: #88ad78; box-shadow: 0 0 0 3px #dcebd5; }
  input { width: 100%; border: 0; outline: 0; padding: 13px 0; color: #17231f; background: transparent; }
  .form-error { margin: 0; color: #a14c3b; font-size: 13px; }
  .login-button { justify-content: center; width: 100%; margin-top: 6px; }
  .register-prompt { margin: 20px 0 0; color: #71837c; font-size: 13px; text-align: center; }
  .register-prompt a { color: #356c4f; font-weight: 700; }
  .button:disabled { opacity: .6; cursor: wait; }
  @media (max-width: 480px) { .login-panel { padding: 30px 24px; } .login-logo { margin-bottom: 22px; } }
</style>

