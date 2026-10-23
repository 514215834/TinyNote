import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useSearchStore = defineStore('search', () => {
  const query = ref('')

  function set(value: string): void {
    query.value = value
  }

  return { query, set }
})
