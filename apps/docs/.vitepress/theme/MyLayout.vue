<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import CopyPageButton from "./components/CopyPageButton.vue";

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <template #aside-outline-before>
      <CopyPageButton />
    </template>
  </Layout>
</template>
