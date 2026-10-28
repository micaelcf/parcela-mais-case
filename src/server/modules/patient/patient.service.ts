import { type Address, normalizeAddress } from "#/lib/address/address";
import { normalizeCpf } from "#/lib/cpf/cpf";
import { normalizePhone } from "#/lib/phone/phone";
import type { Tx } from "#/server/infra/db/client";
import { cpfCrypto } from "#/server/lib/crypto/cpf-crypto";

import { type PatientAddressColumns, patientRepository } from "./patient.repository";

export type PatientInput = {
  cpf: string;
  fullName: string;
  birthdate: string;
  phone: string;
  address: Address;
};

/** The normalised address as columns (`complement` null when absent). */
function addressColumns(input: Address): PatientAddressColumns {
  const address = normalizeAddress(input);
  return {
    addressCep: address.cep,
    addressStreet: address.street,
    addressNumber: address.number,
    addressComplement: address.complement ?? null,
    addressNeighborhood: address.neighborhood,
    addressCity: address.city,
    addressState: address.state,
  };
}

export const patientService = {
  /**
   * Upserts the patient by CPF blind index (the CPF is stored only encrypted, AAD = blind index),
   * then locks the row so concurrent submissions for one CPF run one after another.
   */
  async upsertAndLock(tx: Tx, input: PatientInput): Promise<string> {
    const digits = normalizeCpf(input.cpf);
    const cpfHmac = cpfCrypto.blindIndex(digits);
    const id = await patientRepository.upsertByCpfHmac(tx, {
      cpfHmac,
      cpfCiphertext: cpfCrypto.encrypt(digits, cpfHmac),
      cpfKeyVersion: cpfCrypto.keyVersion,
      fullName: input.fullName.trim(),
      birthdate: input.birthdate,
      phone: normalizePhone(input.phone),
      ...addressColumns(input.address),
    });
    await patientRepository.lockById(tx, id);
    return id;
  },

  /** The CPF digits sealed in a patient row (only lender calls and the backoffice detail need them). */
  revealCpf(row: { cpfHmac: Buffer; cpfCiphertext: Buffer }): string {
    return cpfCrypto.decrypt(row.cpfCiphertext, row.cpfHmac);
  },
};
