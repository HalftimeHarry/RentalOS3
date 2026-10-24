<script lang="ts">
  import { FileText, X } from '@lucide/svelte';

  let { url, name, close }: { url: string; name: string; close: () => void } = $props();
  const isImage = $derived(/\.(png|jpe?g|gif|webp|bmp|svg)(?:\?.*)?$/i.test(url));
</script>

<div class="backdrop" role="presentation" onclick={close}>
  <div class="receipt-dialog" role="dialog" aria-modal="true" aria-label={name} tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => { if (event.key === 'Escape') close(); }}>
    <header><h3>{name}</h3><button class="icon-button" type="button" aria-label="Close receipt" onclick={close}><X size={16} /></button></header>
    {#if isImage}
      <img src={url} alt={name} />
    {:else}
      <div class="file"><FileText size={36} /><p>{name}</p><a class="button" href={url} target="_blank" rel="noreferrer noopener">Open file</a></div>
    {/if}
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: start center; padding: 84px 18px 18px; background: rgba(11, 24, 18, .38); }
  .receipt-dialog { width: min(100%, 860px); max-height: calc(100vh - 110px); overflow: auto; background: #fff; border: 1px solid #dfe8df; border-radius: 8px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border-bottom: 1px solid #edf2ed; }
  h3 { margin: 0; font-size: 16px; overflow-wrap: anywhere; }
  img { display: block; width: 100%; max-height: calc(100vh - 190px); object-fit: contain; background: #f6f8f4; }
  .file { min-height: 260px; display: grid; place-items: center; gap: 12px; padding: 24px; text-align: center; color: #71837c; overflow-wrap: anywhere; }
</style>