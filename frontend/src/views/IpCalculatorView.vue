<script setup lang="ts">
/**
 * IPv4 / IPv6 subnet calculator. Everything runs client side - parsing,
 * mask/wildcard bit math and the subnet split are pure functions in
 * `@/lib/ip`, this view only wires them to the form state.
 */
import { computed } from 'vue'

import AppButton from '@/components/ui/AppButton.vue'
import CopyButton from '@/components/ui/CopyButton.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import ToolPanel from '@/components/ui/ToolPanel.vue'
import { usePersistentState } from '@/composables/usePersistentState'
import {
  analyzeIpv4,
  analyzeIpv6,
  classifyIpv4,
  formatIpv4,
  formatIpv6,
  parseIpv4,
  parseIpv6,
  parsePrefixOrMask4,
  planSubnetsIpv4,
  planSubnetsIpv6,
  prefixFromClassfulMask,
  scopeOfIpv4,
  scopeOfIpv6,
  splitBitGroups,
  toBinaryHextets,
  toBinaryOctets,
  toHexHextets,
  SAMPLE_IPV4,
  SAMPLE_IPV6,
  SAMPLE_PREFIX4,
  SAMPLE_PREFIX6,
  type Ipv4Info,
  type Ipv6Info,
} from '@/lib/ip'

type IpMode = 'v4' | 'v6'

const MODES: Array<{ value: IpMode; label: string }> = [
  { value: 'v4', label: 'IPv4' },
  { value: 'v6', label: 'IPv6' },
]

const mode = usePersistentState<IpMode>('ip:mode', 'v4')

const address4 = usePersistentState('ip:v4:address', SAMPLE_IPV4)
const prefixText4 = usePersistentState('ip:v4:prefix', String(SAMPLE_PREFIX4))
const address6 = usePersistentState('ip:v6:address', SAMPLE_IPV6)
const prefixText6 = usePersistentState('ip:v6:prefix', String(SAMPLE_PREFIX6))
const subnetCount = usePersistentState('ip:subnets', 4)

/* ------------------------------------------------------------------- IPv4 */

const parsed4 = computed<{ info: Ipv4Info | null; error: string | null }>(() => {
  try {
    const address = parseIpv4(address4.value)
    const prefix = parsePrefixOrMask4(prefixText4.value)
    return { info: analyzeIpv4(address, prefix), error: null }
  } catch (error) {
    return { info: null, error: error instanceof Error ? error.message : String(error) }
  }
})

const ipClass4 = computed(() => (parsed4.value.info ? classifyIpv4(parsed4.value.info.address) : null))
const scope4 = computed(() => (parsed4.value.info ? scopeOfIpv4(parsed4.value.info.address) : null))

function applyClassfulMask(): void {
  const cls = ipClass4.value
  if (!cls) return
  prefixText4.value = String(prefixFromClassfulMask(cls))
}

const bitRows4 = computed(() => {
  const info = parsed4.value.info
  if (!info) return null
  const prefix = info.prefix
  const rows: Array<{ label: string; groups: Array<{ network: string; host: string }> }> = [
    { label: 'address', groups: splitBitGroups(toBinaryOctets(info.address), prefix, 8) },
    { label: 'mask', groups: splitBitGroups(toBinaryOctets(info.mask), prefix, 8) },
    { label: 'wildcard', groups: splitBitGroups(toBinaryOctets(info.wildcard), prefix, 8) },
    { label: 'network', groups: splitBitGroups(toBinaryOctets(info.network), prefix, 8) },
    { label: 'broadcast', groups: splitBitGroups(toBinaryOctets(info.broadcast), prefix, 8) },
  ]
  return rows
})

const subnetPlan4 = computed(() => {
  const info = parsed4.value.info
  if (!info) return null
  try {
    return { plan: planSubnetsIpv4(info.network, info.prefix, subnetCount.value), error: null }
  } catch (error) {
    return { plan: null, error: error instanceof Error ? error.message : String(error) }
  }
})

function loadSample4(): void {
  address4.value = SAMPLE_IPV4
  prefixText4.value = String(SAMPLE_PREFIX4)
}

/* ------------------------------------------------------------------- IPv6 */

const parsed6 = computed<{ info: Ipv6Info | null; error: string | null }>(() => {
  try {
    const address = parseIpv6(address6.value)
    const cleaned = prefixText6.value.trim().replace(/^\//, '')
    if (!/^\d{1,3}$/.test(cleaned)) throw new Error('Prefix must be a number between 0 and 128.')
    const prefix = Number(cleaned)
    if (prefix < 0 || prefix > 128) throw new Error('Prefix must be between 0 and 128.')
    return { info: analyzeIpv6(address, prefix), error: null }
  } catch (error) {
    return { info: null, error: error instanceof Error ? error.message : String(error) }
  }
})

const scope6 = computed(() => (parsed6.value.info ? scopeOfIpv6(parsed6.value.info.address) : null))

const bitRows6 = computed(() => {
  const info = parsed6.value.info
  if (!info) return null
  const prefix = info.prefix
  const build = (value: bigint) => ({
    hex: toHexHextets(value),
    bits: splitBitGroups(toBinaryHextets(value), prefix, 16),
  })
  return [
    { label: 'address', ...build(info.address) },
    { label: 'mask', ...build(info.mask) },
    { label: 'wildcard', ...build(info.wildcard) },
    { label: 'network', ...build(info.network) },
  ]
})

const subnetPlan6 = computed(() => {
  const info = parsed6.value.info
  if (!info) return null
  try {
    return { plan: planSubnetsIpv6(info.network, info.prefix, subnetCount.value), error: null }
  } catch (error) {
    return { plan: null, error: error instanceof Error ? error.message : String(error) }
  }
})

function loadSample6(): void {
  address6.value = SAMPLE_IPV6
  prefixText6.value = String(SAMPLE_PREFIX6)
}

/* ------------------------------------------------------------------- misc */

function formatCount(total: bigint | number): string {
  const big = typeof total === 'bigint' ? total : BigInt(total)
  if (big <= 1_000_000n) return big.toLocaleString()
  let bits = 0n
  let v = big
  while (v > 1n) {
    v >>= 1n
    bits++
  }
  return `2^${bits} (~${big.toLocaleString()})`
}
</script>

<template>
  <div class="tool-view">
    <ToolPanel icon="network" title="Address">
      <div class="row">
        <SegmentedControl v-model="mode" :options="MODES" />
        <span class="grow" />
        <AppButton size="sm" icon="info" @click="mode === 'v4' ? loadSample4() : loadSample6()">
          Sample
        </AppButton>
      </div>

      <template v-if="mode === 'v4'">
        <div class="row">
          <label class="field grow">
            <span class="label">ip address</span>
            <input v-model="address4" class="input" placeholder="192.168.1.10" spellcheck="false" />
          </label>
          <label class="field">
            <span class="label">prefix / mask</span>
            <input
              v-model="prefixText4"
              class="input input--narrow"
              placeholder="24 or 255.255.255.0"
              spellcheck="false"
            />
          </label>
          <AppButton size="sm" :disabled="!ipClass4" @click="applyClassfulMask">
            Use class default{{ ipClass4 ? ` (/${ipClass4})` : '' }}
          </AppButton>
        </div>
        <StatusNote v-if="parsed4.error" tone="error">{{ parsed4.error }}</StatusNote>
        <StatusNote v-else-if="parsed4.info" tone="ok">
          Class {{ ipClass4 }} — {{ scope4?.label }}
        </StatusNote>
      </template>

      <template v-else>
        <div class="row">
          <label class="field grow">
            <span class="label">ip address</span>
            <input v-model="address6" class="input" placeholder="2001:db8:abcd:12::" spellcheck="false" />
          </label>
          <label class="field">
            <span class="label">prefix length</span>
            <input v-model="prefixText6" class="input input--narrow" placeholder="64" spellcheck="false" />
          </label>
        </div>
        <StatusNote v-if="parsed6.error" tone="error">{{ parsed6.error }}</StatusNote>
        <StatusNote v-else-if="parsed6.info" tone="ok">{{ scope6 }}</StatusNote>
      </template>
    </ToolPanel>

    <!-- ========================================================= IPv4 ========================================================= -->
    <template v-if="mode === 'v4' && parsed4.info">
      <ToolPanel icon="binary" title="Summary" subtitle="network, mask and host range">
        <template #actions>
          <CopyButton
            :value="`${formatIpv4(parsed4.info.network)}/${parsed4.info.prefix}`"
            label="copy CIDR"
          />
        </template>
        <dl class="summary">
          <div class="summary__row">
            <dt>network</dt>
            <dd>{{ formatIpv4(parsed4.info.network) }}/{{ parsed4.info.prefix }}</dd>
          </div>
          <div class="summary__row">
            <dt>subnet mask</dt>
            <dd>{{ formatIpv4(parsed4.info.mask) }}</dd>
          </div>
          <div class="summary__row">
            <dt>wildcard mask</dt>
            <dd>{{ formatIpv4(parsed4.info.wildcard) }}</dd>
          </div>
          <div class="summary__row">
            <dt>broadcast</dt>
            <dd>{{ formatIpv4(parsed4.info.broadcast) }}</dd>
          </div>
          <div class="summary__row">
            <dt>first host</dt>
            <dd>{{ formatIpv4(parsed4.info.firstHost) }}</dd>
          </div>
          <div class="summary__row">
            <dt>last host</dt>
            <dd>{{ formatIpv4(parsed4.info.lastHost) }}</dd>
          </div>
          <div class="summary__row">
            <dt>total / usable</dt>
            <dd>{{ parsed4.info.totalAddresses.toLocaleString() }} / {{ parsed4.info.usableHosts.toLocaleString() }}</dd>
          </div>
        </dl>
      </ToolPanel>

      <ToolPanel icon="binary" title="Bit operations" subtitle="address · mask · wildcard in binary">
        <div class="bitgrid">
          <div v-for="row in bitRows4" :key="row.label" class="bitgrid__row">
            <span class="bitgrid__label">{{ row.label }}</span>
            <span class="bitgrid__octets">
              <span v-for="(group, index) in row.groups" :key="index" class="bitgrid__octet">
                <span class="bit bit--net">{{ group.network }}</span
                ><span class="bit bit--host">{{ group.host }}</span>
              </span>
            </span>
          </div>
        </div>
        <p class="hint">
          <span class="swatch swatch--net" /> network bits (from the prefix)
          <span class="swatch swatch--host" /> host bits · broadcast = network OR wildcard
        </p>
      </ToolPanel>

      <ToolPanel icon="grid" title="Subnetting" subtitle="split the network above into equal subnets">
        <div class="row">
          <label class="field">
            <span class="label">number of subnets</span>
            <input v-model.number="subnetCount" class="input input--narrow" type="number" min="1" max="65536" />
          </label>
          <span v-if="subnetPlan4?.plan" class="hint grow">
            needs {{ subnetPlan4.plan.newPrefix - parsed4.info.prefix }} extra bit(s) →
            /{{ subnetPlan4.plan.newPrefix }}, {{ subnetPlan4.plan.available }} subnet(s) of
            {{ subnetPlan4.plan.blockSize.toLocaleString() }} addresses each
          </span>
        </div>
        <StatusNote v-if="subnetPlan4?.error" tone="error">{{ subnetPlan4.error }}</StatusNote>
        <StatusNote v-else-if="subnetPlan4?.plan?.truncated" tone="warn">
          Showing the first {{ subnetPlan4.plan.subnets.length }} of {{ subnetPlan4.plan.requested }} subnets.
        </StatusNote>

        <div v-if="subnetPlan4?.plan" class="table-wrap">
          <table class="ranges">
            <thead>
              <tr>
                <th>#</th>
                <th>network</th>
                <th>first host</th>
                <th>last host</th>
                <th>broadcast</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(subnet, index) in subnetPlan4.plan.subnets" :key="index">
                <td>{{ index + 1 }}</td>
                <td class="mono">{{ formatIpv4(subnet.network) }}/{{ subnet.prefix }}</td>
                <td class="mono">{{ formatIpv4(subnet.firstHost) }}</td>
                <td class="mono">{{ formatIpv4(subnet.lastHost) }}</td>
                <td class="mono">{{ formatIpv4(subnet.broadcast) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </ToolPanel>
    </template>

    <!-- ========================================================= IPv6 ========================================================= -->
    <template v-if="mode === 'v6' && parsed6.info">
      <ToolPanel icon="binary" title="Summary" subtitle="network, mask and host range">
        <template #actions>
          <CopyButton
            :value="`${formatIpv6(parsed6.info.network)}/${parsed6.info.prefix}`"
            label="copy CIDR"
          />
        </template>
        <dl class="summary">
          <div class="summary__row">
            <dt>network</dt>
            <dd class="mono-wrap">{{ formatIpv6(parsed6.info.network) }}/{{ parsed6.info.prefix }}</dd>
          </div>
          <div class="summary__row">
            <dt>subnet mask</dt>
            <dd class="mono-wrap">{{ formatIpv6(parsed6.info.mask) }}</dd>
          </div>
          <div class="summary__row">
            <dt>wildcard mask</dt>
            <dd class="mono-wrap">{{ formatIpv6(parsed6.info.wildcard) }}</dd>
          </div>
          <div class="summary__row">
            <dt>last address</dt>
            <dd class="mono-wrap">{{ formatIpv6(parsed6.info.lastAddress) }}</dd>
          </div>
          <div class="summary__row">
            <dt>first host</dt>
            <dd class="mono-wrap">{{ formatIpv6(parsed6.info.firstHost) }}</dd>
          </div>
          <div class="summary__row">
            <dt>last host</dt>
            <dd class="mono-wrap">{{ formatIpv6(parsed6.info.lastHost) }}</dd>
          </div>
          <div class="summary__row">
            <dt>total addresses</dt>
            <dd>{{ formatCount(parsed6.info.totalAddresses) }}</dd>
          </div>
        </dl>
        <StatusNote tone="muted">
          IPv6 has no broadcast address — the last address of the block is shown instead; multicast covers the
          equivalent use cases.
        </StatusNote>
      </ToolPanel>

      <ToolPanel icon="binary" title="Bit operations" subtitle="address · mask · wildcard in hex and binary">
        <div class="bitgrid bitgrid--v6">
          <div v-for="row in bitRows6" :key="row.label" class="bitgrid__row">
            <span class="bitgrid__label">{{ row.label }}</span>
            <span class="bitgrid__hextets">
              <span v-for="(hex, index) in row.hex" :key="index" class="hextet">
                <code class="hextet__hex">{{ hex }}</code>
                <span class="hextet__bits">
                  <span class="bit bit--net">{{ row.bits[index]?.network }}</span
                  ><span class="bit bit--host">{{ row.bits[index]?.host }}</span>
                </span>
              </span>
            </span>
          </div>
        </div>
        <p class="hint">
          <span class="swatch swatch--net" /> network bits (from the prefix)
          <span class="swatch swatch--host" /> host bits · each group is one hextet (16 bits)
        </p>
      </ToolPanel>

      <ToolPanel icon="grid" title="Subnetting" subtitle="split the network above into equal subnets">
        <div class="row">
          <label class="field">
            <span class="label">number of subnets</span>
            <input v-model.number="subnetCount" class="input input--narrow" type="number" min="1" max="65536" />
          </label>
          <span v-if="subnetPlan6?.plan" class="hint grow">
            needs {{ subnetPlan6.plan.newPrefix - parsed6.info.prefix }} extra bit(s) →
            /{{ subnetPlan6.plan.newPrefix }}, {{ subnetPlan6.plan.available }} subnet(s) of
            {{ formatCount(subnetPlan6.plan.blockSize) }} addresses each
          </span>
        </div>
        <StatusNote v-if="subnetPlan6?.error" tone="error">{{ subnetPlan6.error }}</StatusNote>
        <StatusNote v-else-if="subnetPlan6?.plan?.truncated" tone="warn">
          Showing the first {{ subnetPlan6.plan.subnets.length }} of {{ subnetPlan6.plan.requested }} subnets.
        </StatusNote>

        <div v-if="subnetPlan6?.plan" class="table-wrap">
          <table class="ranges">
            <thead>
              <tr>
                <th>#</th>
                <th>network</th>
                <th>first host</th>
                <th>last host</th>
                <th>last address</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(subnet, index) in subnetPlan6.plan.subnets" :key="index">
                <td>{{ index + 1 }}</td>
                <td class="mono">{{ formatIpv6(subnet.network) }}/{{ subnet.prefix }}</td>
                <td class="mono">{{ formatIpv6(subnet.firstHost) }}</td>
                <td class="mono">{{ formatIpv6(subnet.lastHost) }}</td>
                <td class="mono">{{ formatIpv6(subnet.lastAddress) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </ToolPanel>
    </template>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.input--narrow {
  width: 180px;
}

/* ---------- summary ---------- */

.summary {
  display: grid;
  gap: 4px;
  grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
  margin: 0;
}

.summary__row {
  display: flex;
  gap: var(--sp-2);
  align-items: baseline;
  padding: 4px 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-input);
}

.summary__row dt {
  flex: 0 0 110px;
  color: var(--text-dim);
  font-size: var(--fs-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.summary__row dd {
  margin: 0;
  color: var(--accent);
  font-size: var(--fs-sm);
  word-break: break-all;
}

.mono-wrap {
  word-break: break-all;
}

/* ---------- bit grid ---------- */

.bitgrid {
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow-x: auto;
}

.bitgrid__row {
  display: flex;
  gap: var(--sp-3);
  align-items: center;
  padding: 3px 0;
}

.bitgrid__label {
  flex: 0 0 70px;
  color: var(--text-dim);
  font-size: var(--fs-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.bitgrid__octets {
  display: flex;
  gap: var(--sp-2);
}

.bitgrid__octet {
  padding: 2px 6px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  font-size: var(--fs-sm);
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.bitgrid--v6 .bitgrid__row {
  align-items: flex-start;
}

.bitgrid__hextets {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
}

.hextet {
  display: flex;
  flex-direction: column;
  gap: 1px;
  align-items: center;
  padding: 2px 6px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
}

.hextet__hex {
  color: var(--cyan);
  font-size: var(--fs-xs);
  font-weight: 700;
}

.hextet__bits {
  font-size: 0.64rem;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.bit--net {
  color: var(--accent);
  font-weight: 700;
}

.bit--host {
  color: var(--text-dim);
}

.swatch {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin: 0 4px 0 10px;
  border-radius: 2px;
}

.swatch:first-child {
  margin-left: 0;
}

.swatch--net {
  background: var(--accent);
}

.swatch--host {
  background: var(--text-dim);
}

/* ---------- ranges table ---------- */

.table-wrap {
  overflow-x: auto;
}

.ranges {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}

.ranges th {
  padding: 3px 8px;
  border-bottom: 1px solid var(--border);
  color: var(--text-dim);
  font-size: var(--fs-xs);
  font-weight: 500;
  letter-spacing: 0.1em;
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
}

.ranges td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border-soft);
  white-space: nowrap;
}

.ranges .mono {
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
}
</style>
