<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import type { IconName } from '@/components/ui/icons'
import { TOOLS } from '@/tools/registry'

const HIGHLIGHTS: Array<{ icon: IconName; title: string; text: string }> = [
  {
    icon: 'lock',
    title: '100% your tool',
    text: 'Dedicated backend, no telemetry. Secrets never leave the tab.',
  },
  {
    icon: 'zap',
    title: 'Instant feedback',
    text: 'Every tool recomputes as you type - no submit buttons.',
  },
  {
    icon: 'terminal',
    title: 'Keyboard first',
    text: 'Ctrl/Cmd+K opens the quick switcher from anywhere.',
  },
]
</script>

<template>
  <div class="home">
    <section class="hero">
      <pre class="hero__ascii">
 ____             _____           _ _
|  _ \  _____   _|_   _|__   ___ | | |__   _____  __
| | | |/ _ \ \ / / | |/ _ \ / _ \| | '_ \ / _ \ \/ /
| |_| |  __/\ V /  | | (_) | (_) | | |_) | (_) >  <
|____/ \___| \_/   |_|\___/ \___/|_|_.__/ \___/_/\_\</pre
      >
      <p class="hero__text">
        A single tab with the utilities you reach for every day. <br>
        <span class="hero__accent">You build it you own it.</span>
      </p>

      <ul class="highlights">
        <li v-for="item in HIGHLIGHTS" :key="item.title" class="highlight">
          <AppIcon :name="item.icon" :size="15" />
          <div>
            <strong>{{ item.title }}</strong>
            <span>{{ item.text }}</span>
          </div>
        </li>
      </ul>
    </section>

    <section class="grid">
      <RouterLink v-for="tool in TOOLS" :key="tool.id" :to="tool.path" class="card">
        <span class="card__icon"><AppIcon :name="tool.icon" :size="20" /></span>
        <span class="card__body">
          <span class="card__name">{{ tool.name }}</span>
          <span class="card__tag">{{ tool.tagline }}</span>
        </span>
        <span class="card__keys">
          <code v-for="keyword in tool.keywords.slice(0, 4)" :key="keyword">{{ keyword }}</code>
        </span>
      </RouterLink>
    </section>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
  max-width: 1180px;
  margin: 0 auto;
  padding-bottom: var(--sp-4);
}

/* ---------- hero ---------- */

.hero {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-5);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: radial-gradient(circle at 12% 0%, rgb(0 255 156 / 10%), transparent 55%),
    var(--bg-panel);
  box-shadow: var(--shadow-panel);
}

.hero__ascii {
  margin: 0;
  color: var(--accent);
  font-size: clamp(0.4rem, 1.35vw, 0.72rem);
  line-height: 1.15;
  text-shadow: 0 0 18px var(--accent-glow);
  overflow-x: auto;
}

.hero__text {
  margin: 0;
  max-width: 62ch;
  color: var(--text-muted);
  font-size: var(--fs-md);
}

.hero__accent {
  color: var(--accent);
}

.highlights {
  display: grid;
  gap: var(--sp-3);
  grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
  margin: var(--sp-1) 0 0;
  padding: 0;
  list-style: none;
}

.highlight {
  display: flex;
  gap: var(--sp-2);
  align-items: flex-start;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-input);
  color: var(--accent);
}

.highlight div {
  display: flex;
  flex-direction: column;
}

.highlight strong {
  color: var(--text-strong);
  font-size: var(--fs-sm);
  font-weight: 600;
}

.highlight span {
  color: var(--text-dim);
  font-size: var(--fs-xs);
}

/* ---------- tool grid ---------- */

.grid {
  display: grid;
  gap: var(--sp-3);
  grid-template-columns: repeat(auto-fill, minmax(min(290px, 100%), 1fr));
}

.card {
  position: relative;
  display: flex;
  gap: var(--sp-3);
  align-items: flex-start;
  padding: var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  color: inherit;
  text-decoration: none;
  overflow: hidden;
  transition: border-color var(--transition), transform var(--transition),
    box-shadow var(--transition);
}

.card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, var(--accent-ghost), transparent 60%);
  opacity: 0;
  transition: opacity var(--transition);
  pointer-events: none;
}

.card:hover {
  border-color: var(--accent-dim);
  transform: translateY(-2px);
  box-shadow: 0 12px 28px -22px var(--accent);
  text-decoration: none;
}

.card:hover::after {
  opacity: 1;
}

.card__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-input);
  color: var(--accent);
  flex: 0 0 auto;
}

.card__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.card__name {
  color: var(--text-strong);
  font-size: var(--fs-md);
  font-weight: 600;
  letter-spacing: 0.02em;
}

.card__tag {
  color: var(--text-muted);
  font-size: var(--fs-xs);
  line-height: 1.45;
}

.card__keys {
  position: absolute;
  right: var(--sp-3);
  bottom: var(--sp-2);
  display: none;
  gap: 4px;
}

.card__keys code {
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--bg-elevated);
  color: var(--text-dim);
  font-size: 0.6rem;
}

@media (width >= 1100px) {
  .card {
    padding-bottom: var(--sp-5);
  }

  .card__keys {
    display: flex;
  }
}
</style>
