<script setup lang="ts">
import { computed } from 'vue'

import CodeEditor from '@/components/editor/CodeEditor.vue'
import { rangeHighlight, type HighlightRange } from '@/components/editor/rangeHighlight'
import SplitPane from '@/components/layout/SplitPane.vue'
import AppButton from '@/components/ui/AppButton.vue'
import CopyButton from '@/components/ui/CopyButton.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import ToolPanel from '@/components/ui/ToolPanel.vue'
import { usePersistentState } from '@/composables/usePersistentState'
import {
  REGEX_CHEATSHEET,
  REGEX_FLAGS,
  SAMPLE_PATTERN,
  SAMPLE_TEST_TEXT,
  explainPattern,
  replaceWithRegex,
  runRegex,
  splitWithRegex,
} from '@/lib/regex'

type Tab = 'matches' | 'replace' | 'split' | 'explain' | 'cheatsheet'

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'matches', label: 'Matches' },
  { value: 'replace', label: 'Substitute' },
  { value: 'split', label: 'Split' },
  { value: 'explain', label: 'Explain' },
  { value: 'cheatsheet', label: 'Reference' },
]

const pattern = usePersistentState('regex:pattern', SAMPLE_PATTERN)
const flags = usePersistentState('regex:flags', 'gm')
const testText = usePersistentState('regex:text', SAMPLE_TEST_TEXT)
const replacement = usePersistentState('regex:replacement', '$<user> [at] $<domain>')
const tab = usePersistentState<Tab>('regex:tab', 'matches')

const result = computed(() => runRegex(pattern.value, flags.value, testText.value))

const highlights = computed<HighlightRange[]>(() => {
  const ranges: HighlightRange[] = []
  for (const match of result.value.matches) {
    ranges.push({
      from: match.start,
      to: match.end,
      className: match.index % 2 === 0 ? 'cm-rx-match' : 'cm-rx-match-odd',
    })
    for (const group of match.groups) {
      if (group.start >= 0 && group.end > group.start) {
        ranges.push({ from: group.start, to: group.end, className: 'cm-rx-group' })
      }
    }
  }
  return ranges
})

/** Rebuilding the extension array makes `CodeEditor` reconfigure its compartment. */
const testExtensions = computed(() => [rangeHighlight(highlights.value)])

const substitution = computed(() =>
  replaceWithRegex(pattern.value, flags.value, testText.value, replacement.value),
)

const splitParts = computed(() => splitWithRegex(pattern.value, flags.value, testText.value))

const explanation = computed(() => explainPattern(pattern.value))

function toggleFlag(flag: string): void {
  flags.value = flags.value.includes(flag)
    ? flags.value.replace(flag, '')
    : flags.value + flag
}

function loadSample(): void {
  pattern.value = SAMPLE_PATTERN
  flags.value = 'gm'
  testText.value = SAMPLE_TEST_TEXT
  replacement.value = '$<user> [at] $<domain>'
}

const matchList = computed(() => result.value.matches.slice(0, 200))

const literalRegex = computed(() => `/${pattern.value}/${flags.value}`)
</script>

<template>
  <div class="tool-view regex">
    <ToolPanel icon="regex" title="Expression" :subtitle="literalRegex">
      <template #actions>
        <CopyButton :value="literalRegex" label="copy /re/" />
        <AppButton size="sm" icon="info" @click="loadSample">Sample</AppButton>
      </template>

      <div class="expression">
        <span class="expression__delim">/</span>
        <input
          v-model="pattern"
          class="input expression__input"
          placeholder="your pattern here"
          spellcheck="false"
          autocapitalize="off"
          autocorrect="off"
        />
        <span class="expression__delim">/</span>
        <input v-model="flags" class="input expression__flags" spellcheck="false" />
      </div>

      <div class="flags">
        <button
          v-for="item in REGEX_FLAGS"
          :key="item.flag"
          type="button"
          class="flag"
          :class="{ 'is-on': flags.includes(item.flag) }"
          :title="item.hint"
          @click="toggleFlag(item.flag)"
        >
          <code>{{ item.flag }}</code>
          <span>{{ item.label }}</span>
        </button>
      </div>

      <StatusNote v-if="result.error" tone="error">{{ result.error }}</StatusNote>
      <StatusNote v-else tone="ok">
        {{ result.matches.length }} match(es) in {{ result.durationMs.toFixed(2) }} ms
        <template v-if="result.truncated"> — output truncated at 2000 matches</template>
      </StatusNote>
    </ToolPanel>

    <SplitPane class="split--work" storage-key="regex" :min-a="320" :min-b="320">
      <template #a>
        <ToolPanel icon="terminal" title="Test string" :subtitle="`${testText.length} chars`">
          <template #actions>
            <CopyButton :value="testText" label="copy" />
            <AppButton size="sm" variant="danger" icon="trash" @click="testText = ''">Clear</AppButton>
          </template>
          <CodeEditor
            v-model="testText"
            :extensions="testExtensions"
            placeholder="Paste the text you want to match against…"
            min-height="140px"
            class="grow"
          />
        </ToolPanel>
      </template>

      <template #b>
        <ToolPanel icon="search" title="Results">
          <template #actions>
            <SegmentedControl v-model="tab" :options="TABS" size="sm" />
          </template>

          <!-- matches -->
          <div v-if="tab === 'matches'" class="results grow">
            <p v-if="matchList.length === 0" class="hint">No match yet.</p>
            <details v-for="match in matchList" :key="match.index" class="match" open>
              <summary class="match__head">
                <span class="match__index">#{{ match.index + 1 }}</span>
                <code class="match__value">{{ match.value || '∅ (empty match)' }}</code>
                <span class="match__pos">{{ match.start }}–{{ match.end }}</span>
              </summary>
              <ul v-if="match.groups.length > 0" class="groups">
                <li v-for="group in match.groups" :key="group.index" class="groups__item">
                  <span class="groups__name">
                    {{ group.name ? `$<${group.name}>` : `$${group.index}` }}
                  </span>
                  <code class="groups__value" :class="{ 'is-empty': group.value === undefined }">
                    {{ group.value === undefined ? 'undefined' : group.value }}
                  </code>
                </li>
              </ul>
              <p v-else class="hint">no capture groups</p>
            </details>
          </div>

          <!-- substitution -->
          <div v-else-if="tab === 'replace'" class="stack grow">
            <label class="label" for="rx-replacement">replacement pattern</label>
            <input
              id="rx-replacement"
              v-model="replacement"
              class="input"
              placeholder="$1 - $<name>"
              spellcheck="false"
            />
            <StatusNote v-if="substitution.error" tone="error">{{ substitution.error }}</StatusNote>
            <div class="row">
              <span class="label label--inline">result</span>
              <span class="grow" />
              <CopyButton :value="substitution.value" label="copy" />
            </div>
            <CodeEditor
              :model-value="substitution.value"
              readonly
              min-height="140px"
              class="grow"
            />
          </div>

          <!-- split -->
          <div v-else-if="tab === 'split'" class="results grow">
            <StatusNote v-if="splitParts.error" tone="error">{{ splitParts.error }}</StatusNote>
            <StatusNote v-else tone="info">{{ splitParts.parts.length }} part(s)</StatusNote>
            <ol class="split-list">
              <li v-for="(part, index) in splitParts.parts.slice(0, 300)" :key="index">
                <code>{{ part === '' ? '∅' : part }}</code>
              </li>
            </ol>
          </div>

          <!-- explain -->
          <div v-else-if="tab === 'explain'" class="results grow">
            <p v-if="explanation.length === 0" class="hint">Write a pattern to see it explained.</p>
            <ul class="explain">
              <li v-for="(item, index) in explanation" :key="index" class="explain__item">
                <code>{{ item.token }}</code>
                <span>{{ item.description }}</span>
              </li>
            </ul>
          </div>

          <!-- cheat sheet -->
          <div v-else class="results grow">
            <section v-for="group in REGEX_CHEATSHEET" :key="group.group" class="cheat">
              <h3 class="cheat__title">{{ group.group }}</h3>
              <ul class="cheat__list">
                <li v-for="item in group.items" :key="item[0]">
                  <code>{{ item[0] }}</code>
                  <span>{{ item[1] }}</span>
                </li>
              </ul>
            </section>
          </div>
        </ToolPanel>
      </template>
    </SplitPane>
  </div>
</template>

<style scoped>
.regex {
  height: 100%;
}

.split--work {
  flex: 1 1 auto;
  min-height: 450px;
}

/* ---------- expression ---------- */

.expression {
  display: flex;
  gap: 6px;
  align-items: center;
}

.expression__delim {
  color: var(--text-dim);
  font-size: var(--fs-xl);
}

.expression__input {
  flex: 1 1 auto;
  color: var(--accent);
  font-size: var(--fs-lg);
}

.expression__flags {
  width: 84px;
  color: var(--amber);
  font-size: var(--fs-lg);
  text-align: center;
}

.flags {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}

.flag {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-input);
  color: var(--text-dim);
  font-size: var(--fs-xs);
  cursor: pointer;
  transition: border-color var(--transition), color var(--transition), background var(--transition);
}

.flag code {
  color: var(--text-muted);
  font-weight: 700;
}

.flag:hover {
  border-color: var(--border-strong);
  color: var(--text-strong);
}

.flag.is-on {
  border-color: var(--accent-dim);
  background: var(--accent-ghost);
  color: var(--accent);
}

.flag.is-on code {
  color: var(--accent);
}

/* ---------- results ---------- */

.results {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  overflow: auto;
}

.match {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-input);
}

.match__head {
  display: flex;
  gap: var(--sp-2);
  align-items: baseline;
  padding: 5px 8px;
  cursor: pointer;
  list-style: none;
}

.match__head::-webkit-details-marker {
  display: none;
}

.match__index {
  color: var(--accent);
  font-size: var(--fs-xs);
  font-weight: 700;
}

.match__value {
  flex: 1 1 auto;
  color: var(--text-strong);
  font-size: var(--fs-sm);
  word-break: break-all;
}

.match__pos {
  color: var(--text-dim);
  font-size: var(--fs-xs);
  white-space: nowrap;
}

.groups {
  margin: 0;
  padding: 0 8px 7px 24px;
  list-style: none;
}

.groups__item {
  display: flex;
  gap: var(--sp-2);
  align-items: baseline;
  padding: 2px 0;
  border-top: 1px solid var(--border-soft);
}

.groups__name {
  flex: 0 0 110px;
  color: var(--violet);
  font-size: var(--fs-xs);
}

.groups__value {
  color: var(--text-strong);
  font-size: var(--fs-xs);
  word-break: break-all;
}

.groups__value.is-empty {
  color: var(--text-dim);
  font-style: italic;
}

.split-list {
  margin: 0;
  padding-left: 22px;
  color: var(--text-dim);
  font-size: var(--fs-xs);
}

.split-list code {
  color: var(--text-strong);
  word-break: break-all;
}

.explain {
  margin: 0;
  padding: 0;
  list-style: none;
}

.explain__item {
  display: flex;
  gap: var(--sp-3);
  align-items: baseline;
  padding: 3px 6px;
  border-bottom: 1px solid var(--border-soft);
}

.explain__item code {
  flex: 0 0 140px;
  color: var(--amber);
  font-size: var(--fs-sm);
  word-break: break-all;
}

.explain__item span {
  color: var(--text-muted);
  font-size: var(--fs-xs);
}

.cheat {
  margin-bottom: var(--sp-3);
}

.cheat__title {
  margin-bottom: 4px;
  color: var(--cyan);
  font-size: var(--fs-xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.cheat__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.cheat__list li {
  display: flex;
  gap: var(--sp-3);
  align-items: baseline;
  padding: 2px 6px;
  border-bottom: 1px solid var(--border-soft);
}

.cheat__list code {
  flex: 0 0 140px;
  color: var(--accent);
  font-size: var(--fs-xs);
}

.cheat__list span {
  color: var(--text-muted);
  font-size: var(--fs-xs);
}

.label--inline {
  margin: 0;
}
</style>
