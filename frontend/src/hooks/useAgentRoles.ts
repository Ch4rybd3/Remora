import { useQuery } from '@tanstack/react-query'
import { agentsApi, featuresApi } from '../api/agents'
import type { AgentRole } from '../types'

/** Agent roles a playbook step may be handed to; empty while the agent module is off. */
export function useAgentRoles(): AgentRole[] {
  const { data: features } = useQuery({ queryKey: ['features'], queryFn: featuresApi.get, staleTime: Infinity })
  const { data: roles = [] } = useQuery({
    queryKey: ['agent-roles'], queryFn: agentsApi.roles, staleTime: Infinity, enabled: !!features?.charybdis,
  })
  return features?.charybdis ? roles : []
}
