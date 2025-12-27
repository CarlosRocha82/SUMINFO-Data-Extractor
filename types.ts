
export interface InvolvedPerson {
  name: string;
  cpf: string;
  birthDate: string;
  motherName: string;
  condition: string; // Suspeito, Acusado, Envolvido, etc.
}

export interface PoliceOccurrence {
  id: string;
  date: string;
  fact: string;
  isCrime: boolean;
  narrative: string;
  involved: InvolvedPerson[];
}

export interface ExtractionResult {
  occurrences: PoliceOccurrence[];
  rawText: string;
}

export type ReportSubType = 'complete' | 'personal_data_only';

export interface PDFStyleConfig {
  separatorColor: string;
  dataColor: string;
  dataBold: boolean;
  factColor: string;
  factBold: boolean;
  reportSubType?: ReportSubType;
}
