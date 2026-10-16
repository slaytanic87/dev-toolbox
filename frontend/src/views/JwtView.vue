<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import CodeEditor from '@/components/editor/CodeEditor.vue'
import { jwtHighlight } from '@/components/editor/jwtHighlight'
import SplitPane from '@/components/layout/SplitPane.vue'
import AppButton from '@/components/ui/AppButton.vue'
import CopyButton from '@/components/ui/CopyButton.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import ToolPanel from '@/components/ui/ToolPanel.vue'
import { usePersistentState } from '@/composables/usePersistentState'
import { useToast } from '@/composables/useToast'
import {
  JWT_ALGORITHMS,
  SAMPLE_JWT,
  SAMPLE_SECRET,
  decodeJwt,
  describeTimeClaims,
  isJwtAlgorithm,
  isSymmetric,
  signJwt,
  verifyJwt,
  type JwtAlgorithm,
  type JwtKeyFormat,
} from '@/lib/jwt'

type Mode = 'decode' | 'sign'
type VerifyState = 'idle' | 'checking' | 'valid' | 'invalid' | 'error'

const MODES: Array<{ value: Mode; label: string }> = [
  { value: 'decode', label: 'Decode & verify' },
  { value: 'sign', label: 'Sign' },
]

const KEY_FORMATS: Array<{ value: JwtKeyFormat; label: string; title: string }> = [
  { value: 'utf8', label: 'plain', title: 'The secret is used as UTF-8 text' },
  { value: 'base64', label: 'base64', title: 'The secret is base64 encoded binary' },
]

const CLAIM_DOCS: Record<string, string> = {
  iss: 'Issuer - who created and signed the token',
  sub: 'Subject - whom the token refers to',
  aud: 'Audience - who the token is intended for',
  exp: 'Expiration time (seconds since epoch)',
  nbf: 'Not valid before (seconds since epoch)',
  iat: 'Issued at (seconds since epoch)',
  jti: 'JWT ID - unique identifier for this token',
  alg: 'Signing algorithm',
  typ: 'Token type',
  kid: 'Key ID used to select the verification key',
  scope: 'Granted scopes',
  azp: 'Authorised party',
}

const toast = useToast()
const editorExtensions = [jwtHighlight]

const mode = usePersistentState<Mode>('jwt:mode', 'decode')
const token = usePersistentState('jwt:token', SAMPLE_JWT)
const secret = usePersistentState('jwt:secret', SAMPLE_SECRET)
const keyFormat = usePersistentState<JwtKeyFormat>('jwt:keyFormat', 'utf8')
const signAlgorithm = usePersistentState<JwtAlgorithm>('jwt:signAlg', 'HS256')
const headerDraft = usePersistentState('jwt:headerDraft', '{\n  "alg": "HS256",\n  "typ": "JWT"\n}')
const payloadDraft = usePersistentState(
  'jwt:payloadDraft',
  '{\n  "sub": "1234567890",\n  "name": "John Doe",\n  "iat": 1516239022\n}',
)

const verifyState = ref<VerifyState>('idle')
const verifyMessage = ref('')
const signedToken = ref('')
const signError = ref<string | null>(null)

/* ------------------------------------------------------------------ decode */

const decoded = computed(() => {
  if (token.value.trim() === '') return { parts: null, error: null }
  try {
    return { parts: decodeJwt(token.value), error: null }
  } catch (error) {
    return { parts: null, error: error instanceof Error ? error.message : String(error) }
  }
})

const headerJson = computed(() =>
  decoded.value.parts ? JSON.stringify(decoded.value.parts.header, null, 2) : '',
)
const payloadJson = computed(() =>
  decoded.value.parts ? JSON.stringify(decoded.value.parts.payload, null, 2) : '',
)

const algorithm = computed(() => {
  const alg = decoded.value.parts?.header['alg']
  return isJwtAlgorithm(alg) ? alg : null
})

const timeClaims = computed(() =>
  decoded.value.parts ? describeTimeClaims(decoded.value.parts.payload) : [],
)

const claimRows = computed(() => {
  const payload = decoded.value.parts?.payload
  if (!payload) return []
  return Object.entries(payload).map(([key, value]) => ({
    key,
    doc: CLAIM_DOCS[key] ?? '',
    value: typeof value === 'object' ? JSON.stringify(value) : String(value),
  }))
})

const needsPem = computed(() => (algorithm.value ? !isSymmetric(algorithm.value) : false))
const signNeedsPem = computed(() => !isSymmetric(signAlgorithm.value))

/* ------------------------------------------------------------------ verify */

// Asymmetric checks may go through the backend, so a slow answer to an older
// input must never overwrite the result of a newer one.
let verifyRun = 0

async function runVerify(): Promise<void> {
  const run = ++verifyRun
  if (!decoded.value.parts) return
  if (secret.value.trim() === '') {
    verifyState.value = 'idle'
    verifyMessage.value = ''
    return
  }

  verifyState.value = 'checking'
  try {
    const ok = await verifyJwt(token.value, secret.value, keyFormat.value)
    if (run !== verifyRun) return
    verifyState.value = ok ? 'valid' : 'invalid'
    verifyMessage.value = ok
      ? `Signature verified with ${algorithm.value}.`
      : 'Signature does NOT match the supplied key.'
  } catch (error) {
    if (run !== verifyRun) return
    verifyState.value = 'error'
    verifyMessage.value = error instanceof Error ? error.message : String(error)
  }
}

watch([token, secret, keyFormat, mode], () => {
  if (mode.value === 'decode') void runVerify()
}, { immediate: true })

/* -------------------------------------------------------------------- sign */

let signRun = 0

async function runSign(): Promise<void> {
  const run = ++signRun
  try {
    const header = JSON.parse(headerDraft.value) as Record<string, unknown>
    const payload = JSON.parse(payloadDraft.value) as Record<string, unknown>
    header['alg'] = signAlgorithm.value
    if (!header['typ']) header['typ'] = 'JWT'
    headerDraft.value = JSON.stringify(header, null, 2)

    const signed = await signJwt({
      header,
      payload,
      secret: secret.value,
      keyFormat: keyFormat.value,
    })
    if (run !== signRun) return
    signError.value = null
    signedToken.value = signed
  } catch (error) {
    if (run !== signRun) return
    signedToken.value = ''
    signError.value = error instanceof Error ? error.message : String(error)
  }
}

watch([headerDraft, payloadDraft, secret, keyFormat, signAlgorithm, mode], () => {
  if (mode.value === 'sign') void runSign()
}, { immediate: true })

/* ------------------------------------------------------------------ helpers */

function loadSample(): void {
  token.value = SAMPLE_JWT
  secret.value = SAMPLE_SECRET
  keyFormat.value = 'utf8'
  mode.value = 'decode'
}

function sendToSigner(): void {
  if (!decoded.value.parts) {
    toast.error('Decode a valid token first.')
    return
  }
  headerDraft.value = headerJson.value
  payloadDraft.value = payloadJson.value
  if (algorithm.value) signAlgorithm.value = algorithm.value
  mode.value = 'sign'
  toast.success('Loaded into the signer')
}

function useSignedToken(): void {
  if (!signedToken.value) return
  token.value = signedToken.value
  mode.value = 'decode'
}

function setTimestampNow(claim: 'iat' | 'exp' | 'nbf'): void {
  try {
    const payload = JSON.parse(payloadDraft.value) as Record<string, unknown>
    const now = Math.floor(Date.now() / 1000)
    payload[claim] = claim === 'exp' ? now + 3600 : now
    payloadDraft.value = JSON.stringify(payload, null, 2)
  } catch {
    toast.error('The payload is not valid JSON.')
  }
}

const statusTone = computed(() => {
  switch (verifyState.value) {
    case 'valid':
      return 'ok'
    case 'invalid':
    case 'error':
      return 'error'
    default:
      return 'muted'
  }
})

function formatDate(date: Date): string {
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' })
}
</script>

<template>
  <div class="tool-view jwt">
    <ToolPanel icon="key" title="Mode">
      <div class="row">
        <SegmentedControl v-model="mode" :options="MODES" />
        <span class="grow" />
        <AppButton v-if="mode === 'decode'" size="sm" icon="wand" @click="sendToSigner">
          Edit &amp; re-sign
        </AppButton>
        <AppButton v-else size="sm" icon="wand" :disabled="!signedToken" @click="useSignedToken">
          Inspect signed token
        </AppButton>
        <AppButton size="sm" icon="info" @click="loadSample">Sample</AppButton>
      </div>
    </ToolPanel>

    <!-- ============================ DECODE ============================ -->
    <SplitPane v-if="mode === 'decode'" class="split--work" storage-key="jwt:decode" :min-a="320" :min-b="320">
      <template #a>
        <ToolPanel icon="terminal" title="Encoded token" subtitle="header . payload . signature">
          <template #actions>
            <CopyButton :value="token" label="copy" />
            <AppButton size="sm" variant="danger" icon="trash" @click="token = ''">Clear</AppButton>
          </template>

          <CodeEditor
            v-model="token"
            :extensions="editorExtensions"
            :line-numbers="false"
            placeholder="Paste a JWT…"
            min-height="140px"
          />

          <StatusNote v-if="decoded.error" tone="error">{{ decoded.error }}</StatusNote>

          <div class="legend">
            <span class="legend__item legend__item--h">header</span>
            <span class="legend__item legend__item--p">payload</span>
            <span class="legend__item legend__item--s">signature</span>
          </div>

          <div class="keyblock">
            <div class="row">
              <span class="label label--inline">
                {{ needsPem ? 'public key (PEM or certificate)' : 'HMAC secret' }}
              </span>
              <SegmentedControl v-if="!needsPem" v-model="keyFormat" :options="KEY_FORMATS" size="sm" />
            </div>
            <CodeEditor
              v-model="secret"
              :line-numbers="false"
              :placeholder="
                needsPem ? '-----BEGIN PUBLIC KEY-----\n…' : 'your-256-bit-secret'
              "
              min-height="76px"
              max-height="190px"
            />
            <StatusNote :tone="statusTone">
              {{
                verifyState === 'idle'
                  ? 'Enter the key to verify the signature.'
                  : verifyState === 'checking'
                    ? 'Verifying…'
                    : verifyMessage
              }}
            </StatusNote>
          </div>
        </ToolPanel>
      </template>

      <template #b>
        <SplitPane
          orientation="vertical"
          storage-key="jwt:decode-parts"
          :default-ratio="0.4"
          :min-a="120"
          :min-b="120"
        >
          <template #a>
            <ToolPanel icon="braces" title="Header" :subtitle="algorithm ?? ''" class="pane">
              <template #actions><CopyButton :value="headerJson" label="copy" /></template>
              <CodeEditor
                :model-value="headerJson"
                language="json"
                readonly
                min-height="90px"
                placeholder="{}"
              />
            </ToolPanel>
          </template>

          <template #b>
            <ToolPanel icon="braces" title="Payload" class="pane">
              <template #actions><CopyButton :value="payloadJson" label="copy" /></template>
              <CodeEditor
                :model-value="payloadJson"
                language="json"
                readonly
                min-height="90px"
                placeholder="{}"
              />
            </ToolPanel>
          </template>
        </SplitPane>
      </template>
    </SplitPane>

    <!-- ============================= SIGN ============================= -->
    <SplitPane v-else class="split--work" storage-key="jwt:sign" :min-a="320" :min-b="320">
      <template #a>
        <SplitPane
          orientation="vertical"
          storage-key="jwt:sign-parts"
          :default-ratio="0.4"
          :min-a="120"
          :min-b="120"
        >
          <template #a>
            <ToolPanel icon="braces" title="Header" class="pane">
              <template #actions>
                <select v-model="signAlgorithm" class="select select--inline" aria-label="Algorithm">
                  <option v-for="alg in JWT_ALGORITHMS" :key="alg" :value="alg">{{ alg }}</option>
                </select>
              </template>
              <CodeEditor v-model="headerDraft" language="json" lint min-height="90px" />
            </ToolPanel>
          </template>

          <template #b>
            <ToolPanel icon="braces" title="Payload" class="pane">
              <template #actions>
                <AppButton size="sm" @click="setTimestampNow('iat')">iat=now</AppButton>
                <AppButton size="sm" @click="setTimestampNow('exp')">exp=+1h</AppButton>
                <AppButton size="sm" @click="setTimestampNow('nbf')">nbf=now</AppButton>
              </template>
              <CodeEditor v-model="payloadDraft" language="json" lint min-height="90px" />
            </ToolPanel>
          </template>
        </SplitPane>
      </template>

      <template #b>

        <ToolPanel icon="lock" title="Signing key &amp; result">
          <div class="row">
            <span class="label label--inline">
              {{ signNeedsPem ? 'private key (PEM)' : 'HMAC secret' }}
            </span>
            <SegmentedControl v-if="!signNeedsPem" v-model="keyFormat" :options="KEY_FORMATS" size="sm" />
          </div>
          <CodeEditor
            v-model="secret"
            :line-numbers="false"
            :placeholder="signNeedsPem ? '-----BEGIN PRIVATE KEY-----\n…' : 'your-256-bit-secret'"
            min-height="90px"
            max-height="220px"
          />

          <StatusNote v-if="signError" tone="error">{{ signError }}</StatusNote>
          <StatusNote v-else-if="signedToken" tone="ok">
            Signed with {{ signAlgorithm }} · {{ signedToken.length }} characters
          </StatusNote>

          <div class="row">
            <span class="label label--inline">generated token</span>
            <span class="grow" />
            <CopyButton :value="signedToken" label="copy token" />
          </div>
          <CodeEditor
            :model-value="signedToken"
            :extensions="editorExtensions"
            readonly
            :line-numbers="false"
            placeholder="the signed token appears here"
            min-height="140px"
            class="grow"
          />
        </ToolPanel>
      </template>
    </SplitPane>

    <!-- ============================ CLAIMS ============================ -->
    <ToolPanel
      v-if="mode === 'decode' && decoded.parts"
      icon="info"
      title="Registered claims"
      :subtitle="`${claimRows.length} claim(s)`"
    >
      <div v-if="timeClaims.length > 0" class="times">
        <div
          v-for="claim in timeClaims"
          :key="claim.key"
          class="times__item"
          :class="{
            'is-bad': claim.expired || claim.notYetValid,
            'is-good': claim.expired === false || claim.notYetValid === false,
          }"
        >
          <span class="times__key">{{ claim.key }}</span>
          <span class="times__label">{{ claim.label }}</span>
          <span class="times__date">{{ formatDate(claim.date) }}</span>
          <span v-if="claim.expired" class="times__flag">expired</span>
          <span v-else-if="claim.notYetValid" class="times__flag">not yet valid</span>
        </div>
      </div>

      <table class="claims">
        <thead>
          <tr>
            <th>claim</th>
            <th>value</th>
            <th>meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in claimRows" :key="row.key">
            <td class="claims__key">{{ row.key }}</td>
            <td class="claims__value">{{ row.value }}</td>
            <td class="claims__doc">{{ row.doc }}</td>
          </tr>
        </tbody>
      </table>
    </ToolPanel>
  </div>
</template>

<style scoped>
.jwt {
  height: 100%;
}

.split--work {
  flex: 1 1 auto;
  min-height: 480px;
}

.pane {
  flex: 1 1 auto;
}

.label--inline {
  margin: 0;
}

.select--inline {
  width: auto;
  padding: 2px 24px 2px 8px;
  font-size: var(--fs-xs);
}

.keyblock {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.legend {
  display: flex;
  gap: var(--sp-3);
  font-size: var(--fs-xs);
}

.legend__item::before {
  content: '■ ';
}

.legend__item--h {
  color: var(--magenta);
}

.legend__item--p {
  color: var(--violet);
}

.legend__item--s {
  color: var(--cyan);
}

/* ---------- claims ---------- */

.times {
  display: grid;
  gap: var(--sp-2);
  grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
}

.times__item {
  display: grid;
  grid-template-columns: 38px 1fr auto;
  gap: 4px 8px;
  align-items: baseline;
  padding: var(--sp-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-input);
  font-size: var(--fs-xs);
}

.times__item.is-good {
  border-color: rgb(0 255 156 / 30%);
}

.times__item.is-bad {
  border-color: rgb(255 84 102 / 45%);
}

.times__key {
  color: var(--accent);
  font-weight: 600;
}

.times__label {
  color: var(--text-muted);
}

.times__date {
  grid-column: 2 / -1;
  color: var(--text-strong);
  font-size: var(--fs-sm);
}

.times__flag {
  grid-column: 1 / -1;
  color: var(--danger);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.claims {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}

.claims th {
  padding: 3px 8px;
  border-bottom: 1px solid var(--border);
  color: var(--text-dim);
  font-size: var(--fs-xs);
  font-weight: 500;
  letter-spacing: 0.1em;
  text-align: left;
  text-transform: uppercase;
}

.claims td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border-soft);
  vertical-align: top;
  word-break: break-word;
}

.claims__key {
  width: 15%;
  color: var(--cyan);
}

.claims__value {
  width: 40%;
  color: var(--text-strong);
}

.claims__doc {
  color: var(--text-dim);
  font-size: var(--fs-xs);
}
</style>
