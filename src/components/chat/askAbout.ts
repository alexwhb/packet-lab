import type { Field } from '../../model'

/** Values longer than this are left out of the question (the context carries them anyway). */
const VALUE_LIMIT = 32

/** The question "Ask about this" puts in the composer: 'Explain “Time to live” (64) in this packet.' */
export function askAboutQuestion(field: Pick<Field, 'name' | 'value'>): string {
  const value = field.value.replace(/\s+/g, ' ').trim()
  const show = value !== '' && value !== field.name && value.length <= VALUE_LIMIT
  return show ? `Explain “${field.name}” (${value}) in this packet.` : `Explain “${field.name}” in this packet.`
}
