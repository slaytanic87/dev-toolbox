import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

import { TOOLS } from '@/tools/registry'

const APP_TITLE = 'DevToolbox'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
    meta: { title: 'Overview' },
  },
  ...TOOLS.map<RouteRecordRaw>((tool) => ({
    path: tool.path,
    name: tool.id,
    component: tool.component,
    meta: { title: tool.name, toolId: tool.id },
  })),
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  // Hash history keeps the build deployable as plain static files.
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.afterEach((to) => {
  const title = (to.meta['title'] as string | undefined) ?? ''
  document.title = title ? `${APP_TITLE} // ${title}` : APP_TITLE
})
