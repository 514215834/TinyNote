import { useRegisterSW } from 'virtual:pwa-register/vue'

/**
 * Service Worker 更新检测（F-404）。registerType = 'prompt'：发现新版本不自动刷新，
 * needRefresh 置真后由 UpdateBanner 提示用户「刷新更新」，确认后走 updateServiceWorker 重载。
 * 开发模式（devOptions 未开启）下该组合式函数为空操作，不产生任何副作用。
 */
export function usePwaUpdate() {
  const { needRefresh, updateServiceWorker } = useRegisterSW()
  return { needRefresh, updateServiceWorker }
}
