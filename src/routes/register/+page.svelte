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
    } catch {
      error = 'We could not create your account. Check the details and try again.';
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
