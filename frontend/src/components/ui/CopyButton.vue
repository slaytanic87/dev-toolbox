<script setup lang="ts">
import { useClipboard } from '@/composables/useClipboard'

import AppButton from './AppButton.vue'

const props = withDefaults(
  defineProps<{
    value: string
    label?: string
    successLabel?: string
    size?: 'sm' | 'md'
    variant?: 'default' | 'primary' | 'ghost'
  }>(),
  { label: 'Copy', successLabel: 'Copied to clipboard', size: 'sm', variant: 'ghost' },
)

const { copy } = useClipboard()
</script>

<template>
  <AppButton
    icon="copy"
    :size="size"
    :variant="variant"
    :disabled="!props.value"
    :title="`Copy ${label}`"
    @click="copy(props.value, props.successLabel)"
  >
    <template v-if="props.label">{{ props.label }}</template>
  </AppButton>
</template>
