<script setup lang="ts">
import { computed, ref } from 'vue'

import CodeEditor from '@/components/editor/CodeEditor.vue'
import type { EditorLanguage } from '@/components/editor/cmSetup'
import SplitPane from '@/components/layout/SplitPane.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import CopyButton from '@/components/ui/CopyButton.vue'
import KeyValueEditor from '@/components/ui/KeyValueEditor.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import ToolPanel from '@/components/ui/ToolPanel.vue'
import { downloadText } from '@/composables/useClipboard'
import { usePersistentState } from '@/composables/usePersistentState'
import { useToast } from '@/composables/useToast'
import { formatBytes } from '@/lib/bytes'
import {
  HTTP_METHODS,
  createDefaultRequest,
  sendHttpRequest,
  statusTone,
  toCurl,
  createEntry,
  type AuthMode,
  type BodyMode,
  type HttpRequestConfig,
  type HttpResponseResult,
} from '@/lib/http'
import type { RestRequest, RestResponse } from '@/types'

type RequestTab = 'params' | 'headers' | 'body' | 'auth' | 'settings'
type ResponseTab = 'body' | 'headers' | 'curl'

const REQUEST_TABS: Array<{ value: RequestTab; label: string }> = [
  { value: 'params', label: 'Params' },
  { value: 'headers', label: 'Headers' },
  { value: 'body', label: 'Body' },
  { value: 'auth', label: 'Auth' },
  { value: 'settings', label: 'Settings' },
]

const RESPONSE_TABS: Array<{ value: ResponseTab; label: string }> = [
  { value: 'body', label: 'Body' },
  { value: 'headers', label: 'Headers' },
  { value: 'curl', label: 'cURL' },
]

const BODY_MODES: Array<{ value: BodyMode; label: string }> = [
  { value: 'none', label: 'none' },
  { value: 'json', label: 'JSON' },
  { value: 'text', label: 'text' },
  { value: 'form', label: 'multipart' },
  { value: 'urlencoded', label: 'urlencoded' },
]

const AUTH_MODES: Array<{ value: AuthMode; label: string }> = [
  { value: 'none', label: 'none' },
  { value: 'bearer', label: 'bearer' },
  { value: 'basic', label: 'basic' },
  { value: 'apiKey', label: 'api key' },
]

interface HistoryEntry {
  id: string
  method: string
  url: string
  status: number
  at: number
  config: HttpRequestConfig
}

const toast = useToast()

const request = usePersistentState<HttpRequestConfig>('rest:request', createDefaultRequest())
const requestTab = usePersistentState<RequestTab>('rest:requestTab', 'params')
const responseTab = usePersistentState<ResponseTab>('rest:responseTab', 'body')
const prettyBody = usePersistentState('rest:pretty', true)
const history = usePersistentState<HistoryEntry[]>('rest:history', [])

const response = ref<HttpResponseResult | null>(null)
const requestError = ref<string | null>(null)
const inFlight = ref(false)
let controller: AbortController | null = null

/* ------------------------------------------------------------------ sending */

function buildHeaders(): Array<[string, string]> {
  const headers: Array<[string, string]> = request.value.headers.map((item) => [item.key, item.value])
  switch (request.value.auth.mode) {
    case 'bearer':
      if (request.value.auth.token) headers.push(['Authorization', `Bearer ${request.value.auth.token}`])
      break
    case 'basic':
      headers.push(['Authorization', `Basic ${btoa(`${request.value.auth.username}:${request.value.auth.password}`)}`])
      break
    case 'apiKey':
      if (request.value.auth.apiKeyIn === 'header' && request.value.auth.apiKeyName) {
        headers.push([request.value.auth.apiKeyName, request.value.auth.apiKeyValue])
      }
      break
    default:
      break
  }
  return headers
}

function buildQueryString(): string | null {
  if (request.value.auth.mode === 'apiKey' && request.value.auth.apiKeyIn === 'query' && request.value.auth.apiKeyName) {
    request.value.params.push({ id: crypto.randomUUID(), enabled: true, key: request.value.auth.apiKeyName, value: request.value.auth.apiKeyValue })
  }
  return request.value.params.length > 0
    ? request.value.params.map((item) => `${encodeURIComponent(item.key)}=${encodeURIComponent(item.value)}`).join('&')
    : null
}

function buildBody(): string {
  if (request.value.formFields.length > 0 && request.value.bodyMode === 'form') {
    return request.value.formFields.map((item) => `${encodeURIComponent(item.key)}=${encodeURIComponent(item.value)}`).join('&')
  } else {
     return request.value.body
  }
}

async function send(): Promise<void> {
  if (request.value.url.trim() === '') {
    toast.error('Enter a URL first.')
    return
  }
  inFlight.value = true
  requestError.value = null
  response.value = null
  controller = new AbortController()

  let queryString = buildQueryString()

  const restRequest: RestRequest = {
    method: request.value.method,
    path: request.value.url + (queryString ? `?${queryString}` : ''),
    headers: buildHeaders(),
    body: buildBody(),
  }
  let request_backend = JSON.parse(JSON.stringify(request.value)) as HttpRequestConfig
  try {
    request_backend.body = JSON.stringify(restRequest)
    request_backend.method = "POST"
    request_backend.headers = [createEntry("Content-Type", "application/json")]
    request_backend.url = location.protocol.concat("//").concat(window.location.host).concat("/rest")

    const result = await sendHttpRequest(request_backend, controller.signal)
    let response_body = JSON.parse(result.body) as RestResponse
    response.value = {} as HttpResponseResult
    response.value.body = response_body.body as string
    response.value.status = response_body.status
    response.value.ok = result.ok
    response.value.redirected = result.redirected
    response.value.finalUrl = result.finalUrl
    response.value.durationMs = result.durationMs
    response.value.blobUrl = result.blobUrl
    response.value.isBinary = result.isBinary
    response.value.contentType = result.contentType
    response.value.headers = response_body.headers as Array<[string, string]>
    response.value.isBinary = result.isBinary
    response.value.size = result.size
    responseTab.value = 'body'
    pushHistory(result.status)
  } catch (error) {
    requestError.value = error instanceof Error ? error.message : String(error)
  } finally {
    inFlight.value = false
    controller = null
  }
}

function abort(): void {
  controller?.abort()
}

function pushHistory(status: number): void {
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    method: request.value.method,
    url: request.value.url,
    status,
    at: Date.now(),
    config: JSON.parse(JSON.stringify(request.value)) as HttpRequestConfig,
  }
  history.value = [entry, ...history.value.filter((item) => item.id !== entry.id)].slice(0, 25)
}

function restore(entry: HistoryEntry): void {
  request.value = JSON.parse(JSON.stringify(entry.config)) as HttpRequestConfig
  toast.info(`Restored ${entry.method} ${entry.url}`)
}

function resetRequest(): void {
  request.value = createDefaultRequest()
  response.value = null
  requestError.value = null
}

/* ----------------------------------------------------------------- response */

const responseLanguage = computed<EditorLanguage>(() => {
  const type = response.value?.contentType ?? ''
  if (/json/i.test(type)) return 'json'
  if (/html/i.test(type)) return 'html'
  if (/xml/i.test(type)) return 'xml'
  if (/javascript/i.test(type)) return 'javascript'
  return 'text'
})

const responseBody = computed(() => {
  const current = response.value
  if (!current) return ''
  if (current.isBinary) return `[binary payload · ${formatBytes(current.size)} · ${current.contentType}]`
  if (!prettyBody.value || responseLanguage.value !== 'json') return current.body
  try {
    return JSON.stringify(JSON.parse(current.body), null, 2)
  } catch {
    return current.body
  }
})

const responseHeadersText = computed(() =>
  (response.value?.headers ?? []).map(([key, value]) => `${key}: ${value}`).join('\n'),
)

const curlCommand = computed(() => toCurl(request.value))

const tone = computed(() => (response.value ? statusTone(response.value.status) : 'muted'))

const bodyLanguage = computed<EditorLanguage>(() =>
  request.value.bodyMode === 'json' ? 'json' : 'text',
)

const activeCount = computed(() => ({
  params: request.value.params.filter((entry) => entry.enabled && entry.key.trim() !== '').length,
  headers: request.value.headers.filter((entry) => entry.enabled && entry.key.trim() !== '').length,
}))

function saveResponse(): void {
  if (!response.value) return
  const extension = responseLanguage.value === 'json' ? 'json' : 'txt'
  downloadText(`response.${extension}`, responseBody.value)
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour12: false })
}
</script>

<template>
  <div class="tool-view rest">
    <!-- ========================== URL BAR ========================== -->
    <ToolPanel icon="send" title="Request" flush>
      <div class="urlbar">
        <select v-model="request.method" class="select urlbar__method" aria-label="HTTP method">
          <option v-for="method in HTTP_METHODS" :key="method" :value="method">{{ method }}</option>
        </select>

        <input
          v-model="request.url"
          class="input urlbar__url"
          placeholder="https://api.example.com/resource"
          spellcheck="false"
          @keydown.enter="send"
        />

        <AppButton
          v-if="!inFlight"
          variant="primary"
          icon="play"
          :disabled="!request.url"
          @click="send"
        >
          Send
        </AppButton>
        <AppButton v-else variant="danger" icon="x" @click="abort">Abort</AppButton>
        <AppButton variant="ghost" icon="trash" title="Reset request" @click="resetRequest" />
      </div>
    </ToolPanel>

    <SplitPane class="split--work" storage-key="rest" :min-a="320" :min-b="320">
      <template #a>
        <!-- ======================= REQUEST PANE ======================= -->
        <ToolPanel icon="terminal" title="Configuration">
          <template #actions>
            <SegmentedControl v-model="requestTab" :options="REQUEST_TABS" size="sm" />
          </template>

          <!-- params -->
          <div v-if="requestTab === 'params'" class="stack grow">
            <p class="hint">{{ activeCount.params }} active query parameter(s).</p>
            <KeyValueEditor v-model="request.params" key-placeholder="param" />
          </div>

          <!-- headers -->
          <div v-else-if="requestTab === 'headers'" class="stack grow">
            <p class="hint">
              {{ activeCount.headers }} active header(s). Browsers silently drop forbidden headers
              such as <code>Host</code>, <code>Origin</code> or <code>User-Agent</code>.
            </p>
            <KeyValueEditor v-model="request.headers" key-placeholder="header" />
          </div>

          <!-- body -->
          <div v-else-if="requestTab === 'body'" class="stack grow">
            <SegmentedControl v-model="request.bodyMode" :options="BODY_MODES" size="sm" />

            <p v-if="request.method === 'GET' || request.method === 'HEAD'" class="hint">
              {{ request.method }} requests are sent without a body.
            </p>

            <template v-if="request.bodyMode === 'form' || request.bodyMode === 'urlencoded'">
              <KeyValueEditor v-model="request.formFields" key-placeholder="field" />
            </template>
            <template v-else-if="request.bodyMode !== 'none'">
              <CodeEditor
                v-model="request.body"
                :language="bodyLanguage"
                :lint="request.bodyMode === 'json'"
                placeholder="{ }"
                min-height="140px"
                class="grow"
              />
            </template>
          </div>

          <!-- auth -->
          <div v-else-if="requestTab === 'auth'" class="stack grow">
            <SegmentedControl v-model="request.auth.mode" :options="AUTH_MODES" size="sm" />

            <template v-if="request.auth.mode === 'bearer'">
              <label class="label" for="auth-token">token</label>
              <input
                id="auth-token"
                v-model="request.auth.token"
                class="input"
                placeholder="eyJhbGciOi…"
                spellcheck="false"
              />
            </template>

            <template v-else-if="request.auth.mode === 'basic'">
              <label class="label" for="auth-user">username</label>
              <input id="auth-user" v-model="request.auth.username" class="input" spellcheck="false" />
              <label class="label" for="auth-pass">password</label>
              <input id="auth-pass" v-model="request.auth.password" class="input" type="password" />
            </template>

            <template v-else-if="request.auth.mode === 'apiKey'">
              <label class="label" for="auth-key">key name</label>
              <input id="auth-key" v-model="request.auth.apiKeyName" class="input" spellcheck="false" />
              <label class="label" for="auth-val">key value</label>
              <input id="auth-val" v-model="request.auth.apiKeyValue" class="input" spellcheck="false" />
              <label class="label" for="auth-in">send in</label>
              <select id="auth-in" v-model="request.auth.apiKeyIn" class="select">
                <option value="header">header</option>
                <option value="query">query string</option>
              </select>
            </template>

            <p v-else class="hint">No authorisation header will be added.</p>
          </div>

          <!-- settings -->
          <div v-else class="stack grow">
            <label class="label" for="timeout">timeout (ms)</label>
            <input
              id="timeout"
              v-model.number="request.timeoutMs"
              class="input input--narrow"
              type="number"
              min="1000"
              step="1000"
            />
            <label class="checkbox">
              <input v-model="request.followRedirects" type="checkbox" />
              follow redirects
            </label>
            <label class="checkbox">
              <input v-model="request.withCredentials" type="checkbox" />
              send cookies (credentials: include)
            </label>

            <StatusNote tone="info">
              Requests are issued by the browser itself. Cross-origin calls therefore require the
              target server to send permissive CORS headers — exactly like any other web app.
            </StatusNote>
          </div>
        </ToolPanel>
      </template>

      <template #b>

        <!-- ======================= RESPONSE PANE ====================== -->
        <ToolPanel icon="zap" title="Response" :tone="requestError ? 'danger' : 'default'">
          <template #actions>
            <SegmentedControl v-model="responseTab" :options="RESPONSE_TABS" size="sm" />
          </template>

          <div v-if="response" class="meta">
            <span class="meta__status" :class="`meta__status--${tone}`">
              {{ response.status }} {{ response.statusText }}
            </span>
            <span class="meta__item">
              <AppIcon name="refresh" :size="12" />{{ response.durationMs.toFixed(0) }} ms
            </span>
            <span class="meta__item">
              <AppIcon name="download" :size="12" />{{ formatBytes(response.size) }}
            </span>
            <span v-if="response.contentType" class="meta__item meta__item--type">
              {{ response.contentType }}
            </span>
            <span class="grow" />
            <label v-if="responseLanguage === 'json'" class="checkbox">
              <input v-model="prettyBody" type="checkbox" />
              pretty
            </label>
            <AppButton size="sm" icon="download" @click="saveResponse">Save</AppButton>
          </div>

          <StatusNote v-if="inFlight" tone="info">Waiting for the server…</StatusNote>
          <StatusNote v-else-if="requestError" tone="error">{{ requestError }}</StatusNote>
          <StatusNote v-else-if="!response" tone="muted">
            No response yet — configure the request and hit Send.
          </StatusNote>

          <template v-if="responseTab === 'body'">
            <div class="row">
              <span class="grow" />
              <CopyButton :value="responseBody" label="copy body" />
            </div>
            <CodeEditor
              :model-value="responseBody"
              :language="responseLanguage"
              readonly
              fold-gutter
              placeholder="response body"
              min-height="140px"
              class="grow"
            />
          </template>

          <template v-else-if="responseTab === 'headers'">
            <div class="row">
              <span class="grow" />
              <CopyButton :value="responseHeadersText" label="copy headers" />
            </div>
            <table class="headers">
              <tbody>
                <tr v-for="[key, value] in response?.headers ?? []" :key="key">
                  <td class="headers__key">{{ key }}</td>
                  <td class="headers__value">{{ value }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="(response?.headers.length ?? 0) === 0" class="hint">
              No headers available. Cross-origin responses only expose headers listed in
              <code>Access-Control-Expose-Headers</code>.
            </p>
          </template>

          <template v-else>
            <div class="row">
              <span class="grow" />
              <CopyButton :value="curlCommand" label="copy cURL" />
            </div>
            <CodeEditor
              :model-value="curlCommand"
              readonly
              :line-numbers="false"
              min-height="140px"
              class="grow"
            />
          </template>
        </ToolPanel>
      </template>
    </SplitPane>

    <!-- ========================== HISTORY ========================== -->
    <ToolPanel
      class="rest__history"
      icon="clipboard"
      title="History"
      :subtitle="`${history.length} request(s)`"
    >
      <template #actions>
        <AppButton size="sm" variant="danger" icon="trash" @click="history = []">Clear</AppButton>
      </template>

      <p v-if="history.length === 0" class="hint">Sent requests are listed here.</p>
      <ul v-else class="history">
        <li v-for="entry in history" :key="entry.id">
          <button type="button" class="history__item" @click="restore(entry)">
            <span class="history__method">{{ entry.method }}</span>
            <span class="history__status" :class="`history__status--${statusTone(entry.status)}`">
              {{ entry.status }}
            </span>
            <span class="history__url">{{ entry.url }}</span>
            <span class="history__time">{{ formatTime(entry.at) }}</span>
          </button>
        </li>
      </ul>
    </ToolPanel>
  </div>
</template>

<style scoped>
.rest {
  height: 100%;
}

.rest__history {
  max-height: 30vh;
}

/* `SplitPane` stacks the panes itself once the work area gets too narrow. */
.split--work {
  flex: 1 1 auto;
  min-height: 360px;
}

/* ---------- url bar ---------- */

.urlbar {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  flex-wrap: wrap;
  padding: var(--sp-3);
}

.urlbar__method {
  width: 112px;
  color: var(--accent);
  font-weight: 600;
  letter-spacing: 0.05em;
}

.urlbar__url {
  flex: 1 1 240px;
  min-width: 0;
  font-size: var(--fs-md);
}

.input--narrow {
  width: 130px;
}

/* ---------- response meta ---------- */

.meta {
  display: flex;
  gap: var(--sp-3);
  align-items: center;
  flex-wrap: wrap;
  padding: 5px 9px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-input);
  font-size: var(--fs-xs);
}

.meta__status {
  font-size: var(--fs-sm);
  font-weight: 700;
  letter-spacing: 0.04em;
}

.meta__status--ok {
  color: var(--accent);
}

.meta__status--warn {
  color: var(--warn);
}

.meta__status--danger {
  color: var(--danger);
}

.meta__status--muted {
  color: var(--text-muted);
}

.meta__item {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  color: var(--text-muted);
}

.meta__item--type {
  color: var(--text-dim);
  max-width: 230px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- headers table ---------- */

.headers {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}

.headers td {
  padding: 3px 8px;
  border-bottom: 1px solid var(--border-soft);
  vertical-align: top;
  word-break: break-all;
}

.headers__key {
  width: 32%;
  color: var(--cyan);
}

.headers__value {
  color: var(--text-strong);
}

/* ---------- history ---------- */

.history {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.history__item {
  display: flex;
  gap: var(--sp-3);
  align-items: baseline;
  width: 100%;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-muted);
  font-size: var(--fs-xs);
  text-align: left;
  cursor: pointer;
}

.history__item:hover {
  border-color: var(--border);
  background: var(--bg-hover);
}

.history__method {
  flex: 0 0 54px;
  color: var(--accent);
  font-weight: 700;
}

.history__status {
  flex: 0 0 34px;
}

.history__status--ok {
  color: var(--accent);
}

.history__status--warn {
  color: var(--warn);
}

.history__status--danger {
  color: var(--danger);
}

.history__url {
  flex: 1 1 auto;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history__time {
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
</style>
