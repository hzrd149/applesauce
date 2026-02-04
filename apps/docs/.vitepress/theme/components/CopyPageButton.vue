<script setup lang="ts">
import { ref } from "vue";
import { useData } from "vitepress";

const { page } = useData();
const copied = ref(false);
const loading = ref(false);

async function copyPage() {
  if (loading.value) return;

  loading.value = true;
  try {
    // Fetch the raw markdown file
    const response = await fetch(`/${page.value.relativePath}`);
    if (!response.ok) {
      throw new Error("Failed to fetch page content");
    }

    const markdown = await response.text();
    await navigator.clipboard.writeText(markdown);

    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch (err) {
    console.error("Failed to copy page:", err);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="copy-page-button">
    <button @click="copyPage" :disabled="loading" class="button">
      <span v-if="copied">✓ Copied!</span>
      <span v-else>Copy this page</span>
    </button>
  </div>
</template>

<style scoped>
.copy-page-button {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.button {
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.button:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
