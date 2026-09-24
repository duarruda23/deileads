import {
  CheckSquare,
  FileText,
  MessageCircle,
  Phone,
  RefreshCw,
  Video,
  type LucideIcon,
} from 'lucide-react';

/** Mirrors the CHECK constraint in 048_task_types.sql. */
export type TaskType =
  | 'call'
  | 'whatsapp'
  | 'meeting'
  | 'follow_up'
  | 'proposal'
  | 'other';

export const TASK_TYPES: {
  value: TaskType;
  label: string;
  icon: LucideIcon;
}[] = [
  { value: 'follow_up', label: 'Follow-up', icon: RefreshCw },
  { value: 'call', label: 'Ligar', icon: Phone },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { value: 'meeting', label: 'Reunião', icon: Video },
  { value: 'proposal', label: 'Enviar proposta', icon: FileText },
  { value: 'other', label: 'Outro', icon: CheckSquare },
];

export const DEFAULT_TASK_TYPE: TaskType = 'follow_up';

export function getTaskType(value: string | null | undefined) {
  return (
    TASK_TYPES.find((t) => t.value === value) ??
    TASK_TYPES.find((t) => t.value === DEFAULT_TASK_TYPE)!
  );
}
