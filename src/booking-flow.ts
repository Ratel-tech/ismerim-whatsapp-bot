import type { BookingInput } from './agent.js';
import { validateAndCreateBooking, type BookingOutcome } from './bookings.js';
import type { Catalog } from './catalog.js';
import type { Profissional } from './profissionais.js';
import type { Store } from './store.js';

/**
 * Adapta a saída do agente para o contrato de validação do backend e registra
 * o agendamento. O agente usa o campo `professional`; o backend espera
 * `professionalName` — o vínculo com o profissional depende deste mapeamento.
 */
export function createBookingFromAgent(
  store: Store,
  catalog: Catalog,
  profissionais: Profissional[],
  input: BookingInput,
): BookingOutcome {
  return validateAndCreateBooking(
    store,
    catalog,
    {
      jid: input.jid,
      clientName: input.clientName,
      serviceName: input.service,
      date: input.date,
      time: input.time,
      professionalName: input.professional,
    },
    profissionais,
  );
}
