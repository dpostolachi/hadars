import React from 'react';
import { Link } from 'react-router-dom';
import { graphql } from './gql/gql';
import { useFragment } from './gql';
import type { FragmentType } from './gql';

// Co-locate the data requirements for this component with the component itself.
// The parent query only needs to spread `...PostCard` — it doesn't need to know
// which fields PostCard uses.
export const PostCardFragment = graphql(`
    fragment PostCard on BlogPost {
        id
        slug
        title
        date
        author
        excerpt
    }
`);

interface Props {
    post: FragmentType<typeof PostCardFragment>;
}

const PostCard: React.FC<Props> = ({ post: postRef }) => {
    // useFragment "unmasks" the opaque FragmentType into the actual typed fields.
    // This is a compile-time-only operation — zero runtime cost.
    const post = useFragment(PostCardFragment, postRef);

    return (
        <article style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 20, marginBottom: 16 }}>
            <h2 style={{ margin: '0 0 4px' }}>
                <Link to={`/post/${post.slug}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                    {post.title}
                </Link>
            </h2>
            <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 10px' }}>
                {post.date} · {post.author}
            </p>
            <p style={{ margin: 0, color: '#374151' }}>{post.excerpt}</p>
        </article>
    );
};

export default PostCard;
