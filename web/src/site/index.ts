import * as GQL from '../backend/graphqlschema'

export type SiteFlags = Pick<
    GQL.ISite,
    | 'needsRepositoryConfiguration'
    | 'noRepositoriesEnabled'
    | 'hasCodeIntelligence'
    | 'externalAuthEnabled'
    | 'disableBuiltInSearches'
    | 'sendsEmailVerificationEmails'
    | 'updateCheck'
>
