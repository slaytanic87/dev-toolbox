/**
 * Local store for generated certificates, CSRs and keys.
 * Everything lives in this browser's `localStorage` so a CA created in one
 * step can issue leaf certificates in the next one.
 */

import { computed } from 'vue'

import type { CertificateBundle, CsrBundle, IssuerInput, KeyMaterial } from '@/lib/certificates'

import { usePersistentState } from './usePersistentState'

export type VaultKind = 'certificate' | 'csr' | 'key'

/** State of the issuer picker: a stored CA or a manually pasted pair. */
export interface IssuerSelection {
  source: 'vault' | 'manual'
  vaultId: string
  certificate_pem: string
  private_key: string
}

export function createIssuerSelection(): IssuerSelection {
  return { source: 'vault', vaultId: '', certificate_pem: '', private_key: '' }
}

export interface VaultItem {
  id: string
  kind: VaultKind
  label: string
  createdAt: number
  algorithm: string
  isCa: boolean
  subject: string
  notAfter: string
  certificatePem: string
  certificateDer: string
  chainPem: string
  csrPem: string
  csrDer: string
  privateKeyPem: string
  privateKeyDer: string
  publicKeyPem: string
  publicKeyDer: string
}

const EMPTY: Omit<VaultItem, 'id' | 'kind' | 'label' | 'createdAt'> = {
  algorithm: '',
  isCa: false,
  subject: '',
  notAfter: '',
  certificatePem: '',
  certificateDer: '',
  chainPem: '',
  csrPem: '',
  csrDer: '',
  privateKeyPem: '',
  privateKeyDer: '',
  publicKeyPem: '',
  publicKeyDer: '',
}

const MAX_ITEMS = 50

const items = usePersistentState<VaultItem[]>('certificates:vault', [])

function store(item: Omit<VaultItem, 'id' | 'createdAt'>): VaultItem {
  const entry: VaultItem = { ...item, id: crypto.randomUUID(), createdAt: Date.now() }
  items.value = [entry, ...items.value].slice(0, MAX_ITEMS)
  return entry
}

export function useCertificateVault() {
  const authorities = computed(() =>
    items.value.filter(
      (item) => item.kind === 'certificate' && item.isCa && item.privateKeyPem !== '',
    ),
  )
  function addCertificate(label: string, bundle: CertificateBundle): VaultItem {
    return store({
      ...EMPTY,
      kind: 'certificate',
      label,
      algorithm: bundle.key?.algorithm_label ?? bundle.details.public_key_algorithm,
      isCa: bundle.details.is_ca,
      subject: bundle.details.subject,
      notAfter: bundle.details.not_after,
      certificatePem: bundle.certificate_pem,
      certificateDer: bundle.certificate_der,
      chainPem: bundle.chain_pem,
      privateKeyPem: bundle.key?.private_key_pem ?? '',
      privateKeyDer: bundle.key?.private_key_der ?? '',
      publicKeyPem: bundle.key?.public_key_pem ?? '',
      publicKeyDer: bundle.key?.public_key_der ?? '',
    })
  }

  function addCsr(label: string, bundle: CsrBundle): VaultItem {
    return store({
      ...EMPTY,
      kind: 'csr',
      label,
      algorithm: bundle.key?.algorithm_label ?? '',
      subject: bundle.subject,
      csrPem: bundle.csr_pem,
      csrDer: bundle.csr_der,
      privateKeyPem: bundle.key?.private_key_pem ?? '',
      privateKeyDer: bundle.key?.private_key_der ?? '',
      publicKeyPem: bundle.key?.public_key_pem ?? '',
      publicKeyDer: bundle.key?.public_key_der ?? '',
    })
  }

  function addKey(label: string, material: KeyMaterial): VaultItem {
    return store({
      ...EMPTY,
      kind: 'key',
      label,
      algorithm: material.algorithm_label,
      privateKeyPem: material.private_key_pem,
      privateKeyDer: material.private_key_der,
      publicKeyPem: material.public_key_pem,
      publicKeyDer: material.public_key_der,
    })
  }

  function remove(id: string): void {
    items.value = items.value.filter((item) => item.id !== id)
  }

  function clear(): void {
    items.value = []
  }

  function find(id: string): VaultItem | undefined {
    return items.value.find((item) => item.id === id)
  }

  /** Turns the issuer picker state into the payload understood by the backend. */
  function resolveIssuer(selection: IssuerSelection): IssuerInput {
    if (selection.source === 'manual') {
      if (selection.certificate_pem.trim() === '' || selection.private_key.trim() === '') {
        throw new Error('Paste both the issuing certificate and its private key.')
      }
      return { certificate_pem: selection.certificate_pem, private_key: selection.private_key }
    }

    const item = selection.vaultId === '' ? undefined : find(selection.vaultId)
    if (!item) throw new Error('Select a certificate authority from the vault.')
    if (item.privateKeyPem === '') throw new Error('The selected CA has no private key stored.')
    return { certificate_pem: item.certificatePem, private_key: item.privateKeyPem }
  }

  return {
    items,
    authorities,
    addCertificate,
    addCsr,
    addKey,
    remove,
    clear,
    find,
    resolveIssuer,
  }
}
