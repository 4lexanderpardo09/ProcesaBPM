/** A membership loaded with its user's names (the only user columns a ticket read selects). */
export interface PersonName {
  readonly user: { readonly firstName: string; readonly lastName: string };
}

/** How a person is shown next to their id: first and last name. */
export const fullName = (person: PersonName): string => `${person.user.firstName} ${person.user.lastName}`.trim();
