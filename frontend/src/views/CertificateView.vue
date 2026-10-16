<script setup lang="ts">
/**
 * X.509 forge: issue self-signed, CA and CA-signed certificates, create and
 * sign CSRs and inspect existing certificates. All crypto runs in the Rust
 * backend (`/api/certificates`), this view only shapes the request.
 */
import { computed, ref, watch } from 'vue'

import ArtifactActions from '@/components/certificates/ArtifactActions.vue'
import CertificateDetailsCard from '@/components/certificates/CertificateDetailsCard.vue'
import IssuerPicker from '@/components/certificates/IssuerPicker.vue'
import KeyMaterialForm from '@/components/certificates/KeyMaterialForm.vue'
import SubjectForm from '@/components/certificates/SubjectForm.vue'
import CodeEditor from '@/components/editor/CodeEditor.vue'
import SplitPane from '@/components/layout/SplitPane.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import CopyButton from '@/components/ui/CopyButton.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import ToolPanel from '@/components/ui/ToolPanel.vue'
import {
  createIssuerSelection,
  useCertificateVault,
  type IssuerSelection,
  type VaultItem,
} from '@/composables/useCertificateVault'
import { usePersistentState } from '@/composables/usePersistentState'
import { useToast } from '@/composables/useToast'
import {
  CERTIFICATE_FORMATS,
  CSR_FORMATS,
  EXTENDED_KEY_USAGES,
  KEY_FORMATS,
  KEY_USAGES,
  createCertificate,
  createCsr,
  createDefaultSans,
  commonNameOf,
  createDefaultSubject,
  inspectCertificate,
  signCsr,
  slugify,
  type CertificateBundle,
  type CertificateDetails,
  type CsrBundle,
  type ExtendedKeyUsage,
  type KeyInput,
  type KeyUsage,
  type SanInput,
  type SubjectInput,
} from '@/lib/certificates'

const toast = useToast()
const vault = useCertificateVault()

/* -------------------------------------------------------------------- modes */

type Mode = 'certificate' | 'csr' | 'inspect'

const MODES: Array<{ value: Mode; label: string; title: string }> = [
  { value: 'certificate', label: 'certificate', title: 'Issue a self-signed, CA or CA-signed certificate' },
  { value: 'csr', label: 'signing request', title: 'Create a CSR or sign one with a CA' },
  { value: 'inspect', label: 'inspect', title: 'Decode an existing certificate' },
]

const mode = usePersistentState<Mode>('certificates:mode', 'certificate')

/* ----------------------------------------------------------------- profiles */

type ProfileId =
  | 'root-ca'
  | 'intermediate-ca'
  | 'tls-server'
  | 'tls-client'
  | 'tls-server-client'
  | 'code-signing'
  | 'email'
  | 'custom'

interface Profile {
  value: ProfileId
  label: string
  title: string
  isCa: boolean
  pathLength: string
  days: number
  keyUsages: KeyUsage[]
  extendedKeyUsages: ExtendedKeyUsage[]
  signing: 'self' | 'ca'
}

const PROFILES: Profile[] = [
  {
    value: 'root-ca',
    label: 'Root CA',
    title: 'Self-signed authority that signs everything else',
    isCa: true,
    pathLength: '1',
    days: 3650,
    keyUsages: ['key-cert-sign', 'crl-sign', 'digital-signature'],
    extendedKeyUsages: [],
    signing: 'self',
  },
  {
    value: 'intermediate-ca',
    label: 'Intermediate CA',
    title: 'CA signed by another CA',
    isCa: true,
    pathLength: '0',
    days: 1825,
    keyUsages: ['key-cert-sign', 'crl-sign', 'digital-signature'],
    extendedKeyUsages: [],
    signing: 'ca',
  },
  {
    value: 'tls-server',
    label: 'TLS server',
    title: 'HTTPS / gRPC server certificate',
    isCa: false,
    pathLength: '',
    days: 398,
    keyUsages: ['digital-signature', 'key-encipherment'],
    extendedKeyUsages: ['server-auth'],
    signing: 'ca',
  },
  {
    value: 'tls-client',
    label: 'TLS client',
    title: 'mTLS client certificate',
    isCa: false,
    pathLength: '',
    days: 398,
    keyUsages: ['digital-signature', 'key-encipherment'],
    extendedKeyUsages: ['client-auth'],
    signing: 'ca',
  },
  {
    value: 'tls-server-client',
    label: 'TLS server + client',
    title: 'Usable on both ends of an mTLS connection',
    isCa: false,
    pathLength: '',
    days: 398,
    keyUsages: ['digital-signature', 'key-encipherment'],
    extendedKeyUsages: ['server-auth', 'client-auth'],
    signing: 'ca',
  },
  {
    value: 'code-signing',
    label: 'Code signing',
    title: 'Signs binaries and artefacts',
    isCa: false,
    pathLength: '',
    days: 1095,
    keyUsages: ['digital-signature'],
    extendedKeyUsages: ['code-signing'],
    signing: 'ca',
  },
  {
    value: 'email',
    label: 'S/MIME',
    title: 'Email signing and encryption',
    isCa: false,
    pathLength: '',
    days: 730,
    keyUsages: ['digital-signature', 'key-encipherment'],
    extendedKeyUsages: ['email-protection'],
    signing: 'ca',
  },
  {
    value: 'custom',
    label: 'Custom',
    title: 'Keep the current flags untouched',
    isCa: false,
    pathLength: '',
    days: 365,
    keyUsages: [],
    extendedKeyUsages: [],
    signing: 'self',
  },
]

/* ------------------------------------------------------------------- state */

interface CertificateForm {
  profile: ProfileId
  key: KeyInput
  subject: SubjectInput
  sans: SanInput[]
  validityMode: 'days' | 'range'
  days: number
  notBefore: string
  notAfter: string
  serial: string
  isCa: boolean
  pathLength: string
  keyUsages: KeyUsage[]
  extendedKeyUsages: ExtendedKeyUsage[]
  signing: 'self' | 'ca'
  issuer: IssuerSelection
}

function createCertificateForm(): CertificateForm {
  return {
    profile: 'root-ca',
    key: { source: 'generate', algorithm: 'ecdsa-p256', private_key: '' },
    subject: { ...createDefaultSubject(), common_name: 'DevToolbox Root CA' },
    sans: [],
    validityMode: 'days',
    days: 3650,
    notBefore: '',
    notAfter: '',
    serial: '',
    isCa: true,
    pathLength: '1',
    keyUsages: ['key-cert-sign', 'crl-sign', 'digital-signature'],
    extendedKeyUsages: [],
    signing: 'self',
    issuer: createIssuerSelection(),
  }
}

interface CsrForm {
  key: KeyInput
  subject: SubjectInput
  sans: SanInput[]
  keyUsages: KeyUsage[]
  extendedKeyUsages: ExtendedKeyUsage[]
}

function createCsrForm(): CsrForm {
  return {
    key: { source: 'generate', algorithm: 'ecdsa-p256', private_key: '' },
    subject: createDefaultSubject(),
    sans: createDefaultSans(),
    keyUsages: ['digital-signature', 'key-encipherment'],
    extendedKeyUsages: ['server-auth'],
  }
}

interface SignForm {
  csrPem: string
  issuer: IssuerSelection
  days: number
  serial: string
  extendedKeyUsages: ExtendedKeyUsage[]
}

function createSignForm(): SignForm {
  return {
    csrPem: '',
    issuer: createIssuerSelection(),
    days: 398,
    serial: '',
    extendedKeyUsages: [],
  }
}

const form = usePersistentState<CertificateForm>('certificates:form', createCertificateForm())
const csrForm = usePersistentState<CsrForm>('certificates:csr', createCsrForm())
const signForm = usePersistentState<SignForm>('certificates:sign', createSignForm())
const inspectInput = usePersistentState('certificates:inspect', '')

const busy = ref(false)
const error = ref<string | null>(null)
const bundle = ref<CertificateBundle | null>(null)
const csrBundle = ref<CsrBundle | null>(null)
const inspectResult = ref<CertificateDetails | null>(null)
const inspectError = ref<string | null>(null)

type OutputTab = 'certificate' | 'chain' | 'key' | 'details'
const outputTab = ref<OutputTab>('certificate')

const csrTab = usePersistentState<'create' | 'sign'>('certificates:csrTab', 'create')

/* ----------------------------------------------------------------- helpers */

function applyProfile(id: ProfileId): void {
  const profile = PROFILES.find((entry) => entry.value === id)
  if (!profile || profile.value === 'custom') return
  form.value.isCa = profile.isCa
  form.value.pathLength = profile.pathLength
  form.value.days = profile.days
  form.value.validityMode = 'days'
  form.value.keyUsages = [...profile.keyUsages]
  form.value.extendedKeyUsages = [...profile.extendedKeyUsages]
  form.value.signing = profile.signing
  if (profile.value === 'root-ca' && form.value.subject.common_name.trim() === '') {
    form.value.subject.common_name = 'DevToolbox Root CA'
  }
}

watch(() => form.value.profile, applyProfile)

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]
}

const baseName = computed(() => slugify(form.value.subject.common_name, 'certificate'))
const csrBaseName = computed(() => slugify(csrForm.value.subject.common_name, 'request'))

function cleanSans(entries: SanInput[]): SanInput[] {
  return entries
    .filter((entry) => entry.value.trim() !== '')
    .map((entry) => ({ kind: entry.kind, value: entry.value.trim() }))
}

function validity(mode: 'days' | 'range', days: number, notBefore: string, notAfter: string) {
  return mode === 'range'
    ? { not_before: notBefore || undefined, not_after: notAfter || undefined }
    : { days }
}

function fail(cause: unknown): void {
  error.value = cause instanceof Error ? cause.message : String(cause)
  toast.error(error.value)
}

/* ------------------------------------------------------------------ actions */

async function issueCertificate(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const pathLength = form.value.pathLength.trim()
    const payload = {
      key: form.value.key,
      subject: form.value.subject,
      subject_alt_names: cleanSans(form.value.sans),
      validity: validity(
        form.value.validityMode,
        form.value.days,
        form.value.notBefore,
        form.value.notAfter,
      ),
      serial_number: form.value.serial.trim() || undefined,
      constraints: {
        is_ca: form.value.isCa,
        path_length: form.value.isCa && pathLength !== '' ? Number(pathLength) : undefined,
      },
      key_usages: form.value.keyUsages,
      extended_key_usages: form.value.extendedKeyUsages,
      issuer:
        form.value.signing === 'ca' ? vault.resolveIssuer(form.value.issuer) : undefined,
    }

    const result = await createCertificate(payload)
    bundle.value = result
    outputTab.value = 'certificate'
    vault.addCertificate(form.value.subject.common_name || 'certificate', result)
    toast.success(`Issued ${result.details.is_ca ? 'CA' : 'certificate'} for ${baseName.value}`)
  } catch (cause) {
    bundle.value = null
    fail(cause)
  } finally {
    busy.value = false
  }
}

async function buildCsr(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const result = await createCsr({
      key: csrForm.value.key,
      subject: csrForm.value.subject,
      subject_alt_names: cleanSans(csrForm.value.sans),
      key_usages: csrForm.value.keyUsages,
      extended_key_usages: csrForm.value.extendedKeyUsages,
      constraints: { is_ca: false },
    })
    csrBundle.value = result
    signForm.value.csrPem = result.csr_pem
    vault.addCsr(csrForm.value.subject.common_name || 'request', result)
    toast.success('Certificate signing request created')
  } catch (cause) {
    csrBundle.value = null
    fail(cause)
  } finally {
    busy.value = false
  }
}

async function signRequest(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const result = await signCsr({
      csr_pem: signForm.value.csrPem,
      issuer: vault.resolveIssuer(signForm.value.issuer),
      validity: { days: signForm.value.days },
      serial_number: signForm.value.serial.trim() || undefined,
      extended_key_usages: signForm.value.extendedKeyUsages,
    })
    bundle.value = result
    outputTab.value = 'certificate'
    vault.addCertificate(commonNameOf(result.details.subject), result)
    toast.success('Certificate signing request signed')
  } catch (cause) {
    fail(cause)
  } finally {
    busy.value = false
  }
}

async function runInspect(): Promise<void> {
  inspectError.value = null
  if (inspectInput.value.trim() === '') {
    inspectResult.value = null
    return
  }
  try {
    inspectResult.value = await inspectCertificate(inspectInput.value)
  } catch (cause) {
    inspectResult.value = null
    inspectError.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function resetForm(): void {
  form.value = createCertificateForm()
  bundle.value = null
  error.value = null
}

/* -------------------------------------------------------------------- vault */

function useAsIssuer(item: VaultItem): void {
  mode.value = 'certificate'
  form.value.signing = 'ca'
  form.value.issuer = { source: 'vault', vaultId: item.id, certificate_pem: '', private_key: '' }
  toast.info(`${item.label} selected as issuer`)
}

function inspectVaultItem(item: VaultItem): void {
  mode.value = 'inspect'
  inspectInput.value = item.certificatePem
  void runInspect()
}

function reuseKey(item: VaultItem): void {
  const target = mode.value === 'csr' ? csrForm : form
  target.value.key = { source: 'manual', algorithm: undefined, private_key: item.privateKeyPem }
  toast.info('Private key loaded into the form')
}

function vaultIcon(item: VaultItem): 'lock' | 'key' | 'send' {
  if (item.kind === 'key') return 'key'
  return item.kind === 'csr' ? 'send' : 'lock'
}

function formatDate(value: number | string): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

const outputFormats = computed(() => CERTIFICATE_FORMATS)
</script>

<template>
  <div class="tool-view">
    <ToolPanel icon="certificate" title="X.509 forge" subtitle="certificates, keys and signing requests">
      <template #actions>
        <AppButton size="sm" icon="trash" title="Reset the certificate form" @click="resetForm">
          Reset form
        </AppButton>
      </template>
      <SegmentedControl v-model="mode" :options="MODES" />
      <p class="hint">
        Keys and certificates are generated by the local Rust backend with
        <strong>rcgen</strong> and never leave this machine. Download any artefact as
        <strong>.pem</strong>, <strong>.crt</strong>, <strong>.cert</strong>, <strong>.der</strong>
        or <strong>.cer</strong>.
      </p>
    </ToolPanel>

    <!-- ------------------------------------------------------- certificate -->
    <template v-if="mode === 'certificate'">
      <ToolPanel icon="wand" title="Profile" subtitle="presets for the usual certificate shapes">
        <SegmentedControl v-model="form.profile" :options="PROFILES" size="sm" />

        <div class="row">
          <label class="checkbox">
            <input v-model="form.isCa" type="checkbox" />
            certificate authority (CA:TRUE)
          </label>
          <label v-if="form.isCa" class="field">
            <span class="label">path length</span>
            <input
              v-model="form.pathLength"
              class="input input--tiny"
              placeholder="unlimited"
              inputmode="numeric"
            />
          </label>
          <span class="grow" />
          <div class="field">
            <span class="label">signed by</span>
            <SegmentedControl
              v-model="form.signing"
              :options="[
                { value: 'self', label: 'self-signed' },
                { value: 'ca', label: 'a CA' },
              ]"
              size="sm"
            />
          </div>
        </div>

        <div class="row">
          <div class="field">
            <span class="label">validity</span>
            <SegmentedControl
              v-model="form.validityMode"
              :options="[
                { value: 'days', label: 'days' },
                { value: 'range', label: 'date range' },
              ]"
              size="sm"
            />
          </div>
          <label v-if="form.validityMode === 'days'" class="field">
            <span class="label">days</span>
            <input v-model.number="form.days" class="input input--narrow" type="number" min="1" max="36500" />
          </label>
          <template v-else>
            <label class="field">
              <span class="label">not before</span>
              <input v-model="form.notBefore" class="input input--date" type="date" />
            </label>
            <label class="field">
              <span class="label">not after</span>
              <input v-model="form.notAfter" class="input input--date" type="date" />
            </label>
          </template>
          <label class="field">
            <span class="label">serial</span>
            <input
              v-model="form.serial"
              class="input input--narrow"
              placeholder="random"
              spellcheck="false"
              title="Decimal or hex (0x…) - left empty rcgen picks one"
            />
          </label>
        </div>

        <div class="usages">
          <div>
            <span class="label">key usage</span>
            <div class="row">
              <label v-for="usage in KEY_USAGES" :key="usage" class="checkbox">
                <input
                  type="checkbox"
                  :checked="form.keyUsages.includes(usage)"
                  @change="form.keyUsages = toggle(form.keyUsages, usage)"
                />
                {{ usage }}
              </label>
            </div>
          </div>
          <div>
            <span class="label">extended key usage</span>
            <div class="row">
              <label v-for="usage in EXTENDED_KEY_USAGES" :key="usage" class="checkbox">
                <input
                  type="checkbox"
                  :checked="form.extendedKeyUsages.includes(usage)"
                  @change="form.extendedKeyUsages = toggle(form.extendedKeyUsages, usage)"
                />
                {{ usage }}
              </label>
            </div>
          </div>
        </div>
      </ToolPanel>

      <SplitPane sizing="content" storage-key="cert:key" :min-a="320" :min-b="320">
        <template #a>
          <KeyMaterialForm v-model="form.key" :base-name="`${baseName}-key`" />
        </template>

        <template #b>
          <SubjectForm v-model:subject="form.subject" v-model:sans="form.sans" />
        </template>
      </SplitPane>

      <ToolPanel v-if="form.signing === 'ca'" icon="lock" title="Issuing CA" subtitle="who signs this certificate">
        <IssuerPicker v-model="form.issuer" />
      </ToolPanel>

      <ToolPanel icon="zap" title="Issue" :subtitle="form.isCa ? 'creates a CA certificate' : 'creates an end-entity certificate'">
        <div class="row">
          <AppButton variant="primary" icon="play" :disabled="busy" @click="issueCertificate">
            {{ busy ? 'Working…' : 'Generate certificate' }}
          </AppButton>
          <span class="hint">
            The result is stored in the vault below so it can sign further certificates.
          </span>
        </div>
        <StatusNote v-if="error" tone="error">{{ error }}</StatusNote>
      </ToolPanel>
    </template>

    <!-- --------------------------------------------------------------- CSR -->
    <template v-else-if="mode === 'csr'">
      <ToolPanel icon="send" title="Certificate signing request">
        <SegmentedControl
          v-model="csrTab"
          :options="[
            { value: 'create', label: 'create CSR' },
            { value: 'sign', label: 'sign a CSR' },
          ]"
        />
      </ToolPanel>

      <template v-if="csrTab === 'create'">
        <SplitPane sizing="content" storage-key="cert:csr" :min-a="320" :min-b="320">
          <template #a>
            <KeyMaterialForm v-model="csrForm.key" :base-name="`${csrBaseName}-key`" />
          </template>

          <template #b>
            <SubjectForm v-model:subject="csrForm.subject" v-model:sans="csrForm.sans" />
          </template>
        </SplitPane>

        <ToolPanel icon="zap" title="Create">
          <div class="row">
            <AppButton variant="primary" icon="play" :disabled="busy" @click="buildCsr">
              {{ busy ? 'Working…' : 'Create CSR' }}
            </AppButton>
            <span class="hint">Hand the CSR to your CA - the private key stays here.</span>
          </div>
          <StatusNote v-if="error" tone="error">{{ error }}</StatusNote>
        </ToolPanel>

        <ToolPanel v-if="csrBundle" icon="terminal" title="Signing request" :subtitle="csrBundle.subject">
          <ArtifactActions
            :pem="csrBundle.csr_pem"
            :der="csrBundle.csr_der"
            :base-name="csrBaseName"
            :formats="CSR_FORMATS"
            copy-label="copy CSR"
          />
          <CodeEditor :model-value="csrBundle.csr_pem" readonly language="text" min-height="200px" />
          <template v-if="csrBundle.key">
            <span class="label">private key ({{ csrBundle.key.algorithm_label }})</span>
            <ArtifactActions
              :pem="csrBundle.key.private_key_pem"
              :der="csrBundle.key.private_key_der"
              :base-name="`${csrBaseName}-key`"
              :formats="KEY_FORMATS"
              copy-label="copy private key"
            />
            <CodeEditor
              :model-value="csrBundle.key.private_key_pem"
              readonly
              language="text"
              min-height="160px"
            />
          </template>
        </ToolPanel>
      </template>

      <template v-else>
        <ToolPanel icon="upload" title="Request" subtitle="PEM or base64 DER">
          <CodeEditor
            v-model="signForm.csrPem"
            language="text"
            min-height="180px"
            placeholder="-----BEGIN CERTIFICATE REQUEST-----"
          />
        </ToolPanel>

        <ToolPanel icon="lock" title="Issuing CA">
          <IssuerPicker v-model="signForm.issuer" />
          <div class="row">
            <label class="field">
              <span class="label">days</span>
              <input v-model.number="signForm.days" class="input input--narrow" type="number" min="1" />
            </label>
            <label class="field">
              <span class="label">serial</span>
              <input v-model="signForm.serial" class="input input--narrow" placeholder="random" />
            </label>
            <div class="field grow">
              <span class="label">override extended key usage</span>
              <div class="row">
                <label v-for="usage in EXTENDED_KEY_USAGES" :key="usage" class="checkbox">
                  <input
                    type="checkbox"
                    :checked="signForm.extendedKeyUsages.includes(usage)"
                    @change="signForm.extendedKeyUsages = toggle(signForm.extendedKeyUsages, usage)"
                  />
                  {{ usage }}
                </label>
              </div>
            </div>
          </div>
          <div class="row">
            <AppButton variant="primary" icon="play" :disabled="busy" @click="signRequest">
              {{ busy ? 'Working…' : 'Sign request' }}
            </AppButton>
          </div>
          <StatusNote v-if="error" tone="error">{{ error }}</StatusNote>
        </ToolPanel>
      </template>
    </template>

    <!-- ----------------------------------------------------------- inspect -->
    <template v-else>
      <SplitPane sizing="content" storage-key="cert:inspect" :min-a="340" :min-b="340">
        <template #a>
          <ToolPanel icon="search" title="Certificate" subtitle="PEM or base64 DER">
            <template #actions>
              <AppButton size="sm" icon="play" @click="runInspect">Decode</AppButton>
            </template>
            <CodeEditor
              v-model="inspectInput"
              language="text"
              min-height="320px"
              placeholder="-----BEGIN CERTIFICATE-----"
            />
          </ToolPanel>
        </template>

        <template #b>

          <ToolPanel icon="info" title="Details">
            <StatusNote v-if="inspectError" tone="error">{{ inspectError }}</StatusNote>
            <CertificateDetailsCard v-else-if="inspectResult" :details="inspectResult" />
            <p v-else class="hint">
              Paste a certificate and hit decode - works with PEM, base64 DER and files dropped into
              the vault.
            </p>
          </ToolPanel>
        </template>
      </SplitPane>
    </template>

    <!-- ------------------------------------------------------------ output -->
    <ToolPanel
      v-if="bundle && mode !== 'inspect'"
      icon="terminal"
      title="Result"
      :subtitle="bundle.details.subject"
    >
      <template #actions>
        <CopyButton :value="bundle.certificate_pem" label="copy certificate" />
      </template>

      <SegmentedControl
        v-model="outputTab"
        :options="[
          { value: 'certificate', label: 'certificate' },
          { value: 'chain', label: 'chain' },
          { value: 'key', label: 'private key' },
          { value: 'details', label: 'details' },
        ]"
        size="sm"
      />

      <template v-if="outputTab === 'certificate'">
        <ArtifactActions
          :pem="bundle.certificate_pem"
          :der="bundle.certificate_der"
          :base-name="baseName"
          :formats="outputFormats"
        />
        <CodeEditor :model-value="bundle.certificate_pem" readonly language="text" min-height="260px" />
      </template>

      <template v-else-if="outputTab === 'chain'">
        <ArtifactActions
          :pem="bundle.chain_pem"
          :base-name="`${baseName}-chain`"
          :formats="[CERTIFICATE_FORMATS[0]!, CERTIFICATE_FORMATS[1]!, CERTIFICATE_FORMATS[2]!]"
          copy-label="copy chain"
        />
        <CodeEditor :model-value="bundle.chain_pem" readonly language="text" min-height="260px" />
      </template>

      <template v-else-if="outputTab === 'key'">
        <template v-if="bundle.key">
          <ArtifactActions
            :pem="bundle.key.private_key_pem"
            :der="bundle.key.private_key_der"
            :base-name="`${baseName}-key`"
            :formats="KEY_FORMATS"
            copy-label="copy private key"
          />
          <StatusNote tone="warn">
            This private key is only shown here and kept in the vault below - store it somewhere
            safe before closing the tab.
          </StatusNote>
          <CodeEditor :model-value="bundle.key.private_key_pem" readonly language="text" min-height="220px" />
        </template>
        <StatusNote v-else tone="info">
          The certificate was issued from a signing request, so its private key never reached this
          tool.
        </StatusNote>
      </template>

      <CertificateDetailsCard v-else :details="bundle.details" />
    </ToolPanel>

    <!-- ------------------------------------------------------------- vault -->
    <ToolPanel
      icon="lock"
      title="Vault"
      :subtitle="`${vault.items.value.length} stored artefact(s)`"
    >
      <template #actions>
        <AppButton
          size="sm"
          icon="trash"
          variant="danger"
          :disabled="vault.items.value.length === 0"
          @click="vault.clear()"
        >
          Clear
        </AppButton>
      </template>

      <StatusNote v-if="vault.items.value.length > 0" tone="warn">
        Private keys are kept in this browser's local storage so CAs stay reusable - clear the
        vault on shared machines.
      </StatusNote>

      <div v-if="vault.items.value.length > 0" class="vault">
        <article v-for="item in vault.items.value" :key="item.id" class="vault__item">
          <header class="vault__head">
            <AppIcon :name="vaultIcon(item)" :size="13" />
            <strong>{{ item.label }}</strong>
            <span v-if="item.isCa" class="tag">CA</span>
            <span class="tag tag--muted">{{ item.kind }}</span>
            <span class="vault__meta">{{ item.algorithm }}</span>
            <span class="grow" />
            <span class="vault__meta">{{ formatDate(item.createdAt) }}</span>
          </header>

          <p v-if="item.subject" class="vault__subject">{{ item.subject }}</p>
          <p v-if="item.notAfter" class="vault__meta">expires {{ formatDate(item.notAfter) }}</p>

          <div class="row">
            <ArtifactActions
              v-if="item.kind === 'certificate'"
              :pem="item.certificatePem"
              :der="item.certificateDer"
              :base-name="slugify(item.label)"
              :formats="CERTIFICATE_FORMATS"
              copy-label="copy certificate"
            />
            <ArtifactActions
              v-else-if="item.kind === 'csr'"
              :pem="item.csrPem"
              :der="item.csrDer"
              :base-name="slugify(item.label, 'request')"
              :formats="CSR_FORMATS"
              copy-label="copy CSR"
            />
            <ArtifactActions
              v-else
              :pem="item.privateKeyPem"
              :der="item.privateKeyDer"
              :base-name="slugify(item.label, 'key')"
              :formats="KEY_FORMATS"
              copy-label="copy private key"
            />
          </div>

          <div class="row">
            <AppButton
              v-if="item.isCa && item.privateKeyPem"
              size="sm"
              icon="wand"
              @click="useAsIssuer(item)"
            >
              Use as issuer
            </AppButton>
            <AppButton
              v-if="item.kind === 'certificate'"
              size="sm"
              icon="search"
              @click="inspectVaultItem(item)"
            >
              Inspect
            </AppButton>
            <AppButton v-if="item.privateKeyPem" size="sm" icon="key" @click="reuseKey(item)">
              Reuse key
            </AppButton>
            <span class="grow" />
            <AppButton size="sm" icon="trash" variant="danger" @click="vault.remove(item.id)">
              Delete
            </AppButton>
          </div>
        </article>
      </div>

      <p v-else class="hint">
        Nothing stored yet. Generated certificates, signing requests and keys land here so you can
        chain a CA, a leaf certificate and a CSR without copying PEM around.
      </p>
    </ToolPanel>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.input--narrow {
  width: 120px;
}

.input--tiny {
  width: 90px;
}

.input--date {
  width: 160px;
}

.usages {
  display: grid;
  gap: var(--sp-2);
  grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
}

.vault {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.vault__item {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-input);
}

.vault__head {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  flex-wrap: wrap;
  color: var(--text-strong);
  font-size: var(--fs-sm);
}

.vault__meta {
  color: var(--text-dim);
  font-size: var(--fs-xs);
}

.vault__subject {
  color: var(--accent);
  font-size: var(--fs-xs);
  word-break: break-all;
}

.tag {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-ghost);
  color: var(--accent);
  font-size: var(--fs-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.tag--muted {
  background: transparent;
  border: 1px solid var(--border-soft);
  color: var(--text-dim);
}
</style>
