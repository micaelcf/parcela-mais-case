import type { ListQuery, ListResponse } from "#/lib/list/list-contract";
import { normalizeCpf } from "#/lib/cpf/cpf";
import { parseListQuery, toListResponse } from "#/server/infra/db/list-query";
import { cpfCrypto } from "#/server/lib/crypto/cpf-crypto";
import { DomainError } from "#/server/lib/errors/domain-error";
import { isUuid } from "#/server/modules/consultation/consultation.dto";
import { lenderSettingService } from "#/server/modules/lender/lender-setting.service";
import { patientService } from "#/server/modules/patient/patient.service";

import {
  type ConsultationDetail,
  type ConsultationListItem,
  type LenderState,
  LENDER_SLUGS,
  type SearchByCpfRequest,
  type SwitchLogItem,
  type ThrottleEventItem,
  toConsultationDetail,
  toConsultationListItem,
  toSwitchLogItem,
  toThrottleEventItem,
} from "./backoffice.dto";
import {
  backofficeRepository,
  consultationListSpec,
  switchLogListSpec,
  throttleEventListSpec,
} from "./backoffice.repository";

const notFound = () => new DomainError("CONSULTATION_NOT_FOUND", "Consulta não encontrada.");

/** Backoffice tables, the consultation detail and the kill switch (RF-608/609, RF-611–613, RF-615/616). */
export const backofficeService = {
  async listConsultations(query: ListQuery): Promise<ListResponse<ConsultationListItem>> {
    const parsed = parseListQuery(query, consultationListSpec);
    const { rows, total } = await backofficeRepository.listConsultations(parsed);
    return toListResponse(rows.map(toConsultationListItem), total, parsed);
  },

  /**
   * Exact match through the blind index: the CPF never reaches SQL, so no prefix search exists.
   * The rest of the body is the explorer's list query, checked against the same allow-lists.
   */
  async searchByCpf({
    cpf,
    ...query
  }: SearchByCpfRequest): Promise<ListResponse<ConsultationListItem>> {
    const parsed = parseListQuery(query, consultationListSpec);
    const cpfHmac = cpfCrypto.blindIndex(normalizeCpf(cpf));
    const { rows, total } = await backofficeRepository.listConsultations(parsed, { cpfHmac });
    return toListResponse(rows.map(toConsultationListItem), total, parsed);
  },

  /** Full patient data with the CPF decrypted (AAD = its blind index). */
  async consultationDetail(id: string): Promise<ConsultationDetail> {
    if (!isUuid(id)) throw notFound();
    const rows = await backofficeRepository.findConsultationDetail(id);
    if (!rows) throw notFound();
    return toConsultationDetail(rows, patientService.revealCpf(rows.patient));
  },

  async listSwitchLog(query: ListQuery): Promise<ListResponse<SwitchLogItem>> {
    const parsed = parseListQuery(query, switchLogListSpec);
    const { rows, total } = await backofficeRepository.listSwitchLog(parsed);
    return toListResponse(rows.map(toSwitchLogItem), total, parsed);
  },

  async listThrottleEvents(query: ListQuery): Promise<ListResponse<ThrottleEventItem>> {
    const parsed = parseListQuery(query, throttleEventListSpec);
    const { rows, total } = await backofficeRepository.listThrottleEvents(parsed);
    return toListResponse(rows.map(toThrottleEventItem), total, parsed);
  },

  /** Flips the kill switch; the lender module appends the switch log in the same TX. */
  async setLenderEnabled(input: {
    slug: keyof typeof LENDER_SLUGS;
    enabled: boolean;
    actor: string;
  }): Promise<LenderState> {
    const saved = await lenderSettingService.setEnabled({
      lender: LENDER_SLUGS[input.slug],
      enabled: input.enabled,
      actor: input.actor,
    });
    return { ...saved, updatedAt: saved.updatedAt.toISOString() };
  },
};
