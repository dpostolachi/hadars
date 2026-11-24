import React from 'react';
import { HadarsHead } from 'hadars';
import Code from '../../components/Code';

const RegistryEnvironments: React.FC = () => (
    <>
        <HadarsHead status={200}>
            <title>Registry environments — hadars</title>
            <meta name="description" content="How the hadars registry tracks which package versions run in dev, staging and production, and how to move, compare and roll back environments." />
            <meta property="og:title" content="Registry environments — hadars" />
            <meta property="og:description" content="Move package versions through dev, staging and production, and roll back to any earlier revision." />
        </HadarsHead>

        <h1 className="text-3xl font-bold mb-3 text-gradient">Environments and revisions</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl">
            The registry records which version of each package runs in each environment. A change to an environment
            is a move, and every move creates a numbered revision you can inspect and return to.
        </p>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Set and promote versions</h2>
            <p className="text-muted-foreground mb-4">
                Set one package in an environment, or several packages together so they move in one revision.
                Promote copies the versions from one environment to the next.
            </p>
            <Code lang="bash">{`
# One package
hadars set dev shell@7

# Several packages, one revision
hadars set dev shell@7 catalog@42 checkout@3

# Copy versions from staging to production (optionally only some packages)
hadars promote staging production --only catalog
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">History and rollback</h2>
            <p className="text-muted-foreground mb-4">
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">history</code> lists the revisions of an
                environment with the packages each one changed. <code className="text-sm bg-muted px-1.5 py-0.5 rounded">go-back</code>{' '}
                restores the versions of an earlier revision as a new revision, so nothing is lost.
            </p>
            <Code lang="bash">{`
hadars history production
hadars go-back production 12
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Avoid overwriting someone else's move</h2>
            <p className="text-muted-foreground mb-4">
                Pass <code className="text-sm bg-muted px-1.5 py-0.5 rounded">--expected-revision &lt;n&gt;</code> to
                make a move fail if the environment has moved since revision <code className="text-sm bg-muted px-1.5 py-0.5 rounded">n</code>.
                Use it in CI, where two runs could otherwise race.
            </p>
            <Code lang="bash">{`
hadars set production shell@7 --expected-revision 41
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Previews</h2>
            <p className="text-muted-foreground mb-4">
                A preview is a short-lived environment built from another one, with a few packages overridden. Use
                it to test a change before it reaches staging. Previews expire unless you extend them.
            </p>
            <Code lang="bash">{`
hadars preview create pr-123 --from staging --set catalog=#57 --ttl 7d
hadars preview rebase pr-123            # show what changes if the base moved
hadars preview rebase pr-123 --apply
hadars preview extend pr-123 --ttl 7d
hadars preview promote pr-123 staging
hadars preview delete pr-123
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Protected environments</h2>
            <p className="text-muted-foreground mb-4">
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">production</code> is protected by default.
                Once a team has a signing key, moves to a protected environment must be signed. See{' '}
                <a className="underline" href="/docs/registry-signing">Signing and trusted pulls</a>.
            </p>
        </section>
    </>
);

export default RegistryEnvironments;
