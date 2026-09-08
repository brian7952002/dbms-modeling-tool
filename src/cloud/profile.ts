import { requireClient } from './supabase';

export interface Profile {
  displayName: string;
  email: string | null;
}

/**
 * The name teammates see next to a change. Stored separately from the auth
 * record because auth.users is not readable from the browser.
 */
export async function getProfile(userId: string): Promise<Profile> {
  const { data, error } = await requireClient()
    .from('profiles')
    .select('display_name,email')
    .eq('id', userId)
    .single();
  if (error) throw new Error(error.message);
  return {
    displayName: (data.display_name as string) ?? '',
    email: (data.email as string) ?? null,
  };
}

export async function updateDisplayName(userId: string, displayName: string): Promise<void> {
  const { error } = await requireClient()
    .from('profiles')
    .update({ display_name: displayName.trim() })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}
