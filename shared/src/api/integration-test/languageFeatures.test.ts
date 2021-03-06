import { Location } from '@sourcegraph/extension-api-types'
import { asyncScheduler, Observable, of } from 'rxjs'
import { observeOn, take, toArray } from 'rxjs/operators'
import * as sourcegraph from 'sourcegraph'
import { languages as sourcegraphLanguages } from 'sourcegraph'
import { Services } from '../client/services'
import { assertToJSON } from '../extension/types/testHelpers'
import { URI } from '../extension/types/uri'
import { createBarrier, integrationTestContext } from './testHelpers'

describe('LanguageFeatures (integration)', () => {
    testLocationProvider<sourcegraph.HoverProvider>({
        name: 'registerHoverProvider',
        registerProvider: extensionAPI => (s, p) => extensionAPI.languages.registerHoverProvider(s, p),
        labeledProvider: label => ({
            provideHover: (doc: sourcegraph.TextDocument, pos: sourcegraph.Position) =>
                of({
                    contents: { value: label, kind: sourcegraph.MarkupKind.PlainText },
                }).pipe(observeOn(asyncScheduler)),
        }),
        labeledProviderResults: labels => ({
            contents: labels.map(label => ({ value: label, kind: sourcegraph.MarkupKind.PlainText })),
        }),
        providerWithImplementation: run => ({ provideHover: run } as sourcegraph.HoverProvider),
        getResult: services =>
            services.textDocumentHover.getHover({
                textDocument: { uri: 'file:///f' },
                position: { line: 1, character: 2 },
            }),
    })
    testLocationProvider<sourcegraph.DefinitionProvider>({
        name: 'registerDefinitionProvider',
        registerProvider: extensionAPI => extensionAPI.languages.registerDefinitionProvider,
        labeledProvider: label => ({
            provideDefinition: (doc: sourcegraph.TextDocument, pos: sourcegraph.Position) =>
                of([{ uri: new URI(`file:///${label}`) }]).pipe(observeOn(asyncScheduler)),
        }),
        labeledProviderResults: labeledDefinitionResults,
        providerWithImplementation: run => ({ provideDefinition: run } as sourcegraph.DefinitionProvider),
        getResult: services =>
            services.textDocumentDefinition.getLocations({
                textDocument: { uri: 'file:///f' },
                position: { line: 1, character: 2 },
            }),
    })
    // tslint:disable deprecation The tests must remain until they are removed.
    testLocationProvider({
        name: 'registerTypeDefinitionProvider',
        registerProvider: extensionAPI => extensionAPI.languages.registerTypeDefinitionProvider,
        labeledProvider: label => ({
            provideTypeDefinition: (doc: sourcegraph.TextDocument, pos: sourcegraph.Position) =>
                of([{ uri: new URI(`file:///${label}`) }]).pipe(observeOn(asyncScheduler)),
        }),
        labeledProviderResults: labeledDefinitionResults,
        providerWithImplementation: run => ({ provideTypeDefinition: run } as sourcegraph.TypeDefinitionProvider),
        getResult: services =>
            services.textDocumentTypeDefinition.getLocations({
                textDocument: { uri: 'file:///f' },
                position: { line: 1, character: 2 },
            }),
    })
    testLocationProvider<sourcegraph.ImplementationProvider>({
        name: 'registerImplementationProvider',
        registerProvider: extensionAPI => extensionAPI.languages.registerImplementationProvider,
        labeledProvider: label => ({
            provideImplementation: (doc: sourcegraph.TextDocument, pos: sourcegraph.Position) =>
                of([{ uri: new URI(`file:///${label}`) }]).pipe(observeOn(asyncScheduler)),
        }),
        labeledProviderResults: labeledDefinitionResults,
        providerWithImplementation: run => ({ provideImplementation: run } as sourcegraph.ImplementationProvider),
        getResult: services =>
            services.textDocumentImplementation.getLocations({
                textDocument: { uri: 'file:///f' },
                position: { line: 1, character: 2 },
            }),
    })
    // tslint:enable deprecation
    testLocationProvider<sourcegraph.ReferenceProvider>({
        name: 'registerReferenceProvider',
        registerProvider: extensionAPI => extensionAPI.languages.registerReferenceProvider,
        labeledProvider: label => ({
            provideReferences: (
                doc: sourcegraph.TextDocument,
                pos: sourcegraph.Position,
                context: sourcegraph.ReferenceContext
            ) => of([{ uri: new URI(`file:///${label}`) }]).pipe(observeOn(asyncScheduler)),
        }),
        labeledProviderResults: labels => labels.map(label => ({ uri: `file:///${label}`, range: undefined })),
        providerWithImplementation: run =>
            ({
                provideReferences: (
                    doc: sourcegraph.TextDocument,
                    pos: sourcegraph.Position,
                    _context: sourcegraph.ReferenceContext
                ) => run(doc, pos),
            } as sourcegraph.ReferenceProvider),
        getResult: services =>
            services.textDocumentReferences.getLocations({
                textDocument: { uri: 'file:///f' },
                position: { line: 1, character: 2 },
                context: { includeDeclaration: true },
            }),
    })
    testLocationProvider<sourcegraph.LocationProvider>({
        name: 'registerLocationProvider',
        registerProvider: extensionAPI => (selector, provider) =>
            extensionAPI.languages.registerLocationProvider('x', selector, provider),
        labeledProvider: label => ({
            provideLocations: (doc: sourcegraph.TextDocument, pos: sourcegraph.Position) =>
                of([{ uri: new URI(`file:///${label}`) }]).pipe(observeOn(asyncScheduler)),
        }),
        labeledProviderResults: labels => labels.map(label => ({ uri: `file:///${label}`, range: undefined })),
        providerWithImplementation: run =>
            ({
                provideLocations: (doc: sourcegraph.TextDocument, pos: sourcegraph.Position) => run(doc, pos),
            } as sourcegraph.LocationProvider),
        getResult: services =>
            services.textDocumentLocations.getLocations('x', {
                textDocument: { uri: 'file:///f' },
                position: { line: 1, character: 2 },
            }),
    })
})

/**
 * Generates test cases for sourcegraph.languages.registerXyzProvider functions and their associated
 * XyzProviders, for providers that return a list of locations.
 */
function testLocationProvider<P>({
    name,
    registerProvider,
    labeledProvider,
    labeledProviderResults,
    providerWithImplementation,
    getResult,
}: {
    name: keyof typeof sourcegraphLanguages
    registerProvider: (
        extensionAPI: typeof sourcegraph
    ) => (selector: sourcegraph.DocumentSelector, provider: P) => sourcegraph.Unsubscribable
    labeledProvider: (label: string) => P
    labeledProviderResults: (labels: string[]) => any
    providerWithImplementation: (run: (doc: sourcegraph.TextDocument, pos: sourcegraph.Position) => void) => P
    getResult: (services: Services) => Observable<any>
}): void {
    describe(`languages.${name}`, () => {
        test('registers and unregisters a single provider', async () => {
            const { services, extensionAPI } = await integrationTestContext()

            // Register the provider and call it.
            const subscription = registerProvider(extensionAPI)(['*'], labeledProvider('a'))
            await extensionAPI.internal.sync()
            expect(
                await getResult(services)
                    .pipe(take(1))
                    .toPromise()
            ).toEqual(labeledProviderResults(['a']))

            // Unregister the provider and ensure it's removed.
            subscription.unsubscribe()
            expect(
                await getResult(services)
                    .pipe(take(1))
                    .toPromise()
            ).toEqual(null)
        })

        test('supplies params to the provideXyz method', async () => {
            const { services, extensionAPI } = await integrationTestContext()
            const { wait, done } = createBarrier()
            registerProvider(extensionAPI)(
                ['*'],
                providerWithImplementation((doc, pos) => {
                    assertToJSON(doc, { uri: 'file:///f', languageId: 'l', text: 't' })
                    assertToJSON(pos, { line: 1, character: 2 })
                    done()
                })
            )
            await extensionAPI.internal.sync()
            await getResult(services)
                .pipe(take(1))
                .toPromise()
            await wait
        })

        test('supports multiple providers', async () => {
            const { services, extensionAPI } = await integrationTestContext()

            // Register 2 providers with different results.
            registerProvider(extensionAPI)(['*'], labeledProvider('a'))
            registerProvider(extensionAPI)(['*'], labeledProvider('b'))
            await extensionAPI.internal.sync()

            // Expect it to emit the first provider's result first (and not block on both providers being ready).
            expect(
                await getResult(services)
                    .pipe(
                        take(2),
                        toArray()
                    )
                    .toPromise()
            ).toEqual([labeledProviderResults(['a']), labeledProviderResults(['a', 'b'])])
        })
    })
}

function labeledDefinitionResults(labels: string[]): Location | Location[] {
    return labels.map(label => ({ uri: `file:///${label}`, range: undefined }))
}
