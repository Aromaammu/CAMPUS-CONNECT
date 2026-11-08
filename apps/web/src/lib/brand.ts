import { useQuery } from '@tanstack/react-query';
import { get } from './api';

export interface Brand { name: string; tagline: string; supportEmail: string; supportPhone: string; legalName: string; address: string; grievanceOfficer: string; grievanceEmail: string }
const FALLBACK: Brand = { name: 'Campus Connect', tagline: 'Live learning for every branch', supportEmail: '', supportPhone: '', legalName: '', address: '', grievanceOfficer: '', grievanceEmail: '' };

export function useBrand(): Brand {
  const q = useQuery({ queryKey: ['brand'], queryFn: () => get<Brand>('/public/brand'), staleTime: 5 * 60_000 });
  return q.data ?? FALLBACK;
}
