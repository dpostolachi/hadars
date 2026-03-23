/* eslint-disable */
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = T | null | undefined;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

export type BlogPost = {
  __typename?: 'BlogPost';
  author?: Maybe<Scalars['String']['output']>;
  body?: Maybe<Scalars['String']['output']>;
  date?: Maybe<Scalars['String']['output']>;
  excerpt?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  slug?: Maybe<Scalars['String']['output']>;
  title?: Maybe<Scalars['String']['output']>;
};

export type Directory = {
  __typename?: 'Directory';
  absolutePath?: Maybe<Scalars['String']['output']>;
  accessTime?: Maybe<Scalars['String']['output']>;
  atime?: Maybe<Scalars['String']['output']>;
  atimeMs?: Maybe<Scalars['Int']['output']>;
  base?: Maybe<Scalars['String']['output']>;
  birthTime?: Maybe<Scalars['String']['output']>;
  birthtime?: Maybe<Scalars['String']['output']>;
  birthtimeMs?: Maybe<Scalars['Int']['output']>;
  blksize?: Maybe<Scalars['Int']['output']>;
  blocks?: Maybe<Scalars['Int']['output']>;
  changeTime?: Maybe<Scalars['String']['output']>;
  ctime?: Maybe<Scalars['String']['output']>;
  ctimeMs?: Maybe<Scalars['Int']['output']>;
  dev?: Maybe<Scalars['Int']['output']>;
  dir?: Maybe<Scalars['String']['output']>;
  ext?: Maybe<Scalars['String']['output']>;
  extension?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  ino?: Maybe<Scalars['Int']['output']>;
  mode?: Maybe<Scalars['Int']['output']>;
  modifiedTime?: Maybe<Scalars['String']['output']>;
  mtime?: Maybe<Scalars['String']['output']>;
  mtimeMs?: Maybe<Scalars['Int']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  nlink?: Maybe<Scalars['Int']['output']>;
  prettySize?: Maybe<Scalars['String']['output']>;
  rdev?: Maybe<Scalars['Int']['output']>;
  relativeDirectory?: Maybe<Scalars['String']['output']>;
  relativePath?: Maybe<Scalars['String']['output']>;
  root?: Maybe<Scalars['String']['output']>;
  size?: Maybe<Scalars['Int']['output']>;
  sourceInstanceName?: Maybe<Scalars['String']['output']>;
  uid?: Maybe<Scalars['Int']['output']>;
};

export type File = {
  __typename?: 'File';
  absolutePath?: Maybe<Scalars['String']['output']>;
  accessTime?: Maybe<Scalars['String']['output']>;
  atime?: Maybe<Scalars['String']['output']>;
  atimeMs?: Maybe<Scalars['Int']['output']>;
  base?: Maybe<Scalars['String']['output']>;
  birthTime?: Maybe<Scalars['String']['output']>;
  birthtime?: Maybe<Scalars['String']['output']>;
  birthtimeMs?: Maybe<Scalars['Int']['output']>;
  blksize?: Maybe<Scalars['Int']['output']>;
  blocks?: Maybe<Scalars['Int']['output']>;
  changeTime?: Maybe<Scalars['String']['output']>;
  ctime?: Maybe<Scalars['String']['output']>;
  ctimeMs?: Maybe<Scalars['Int']['output']>;
  dev?: Maybe<Scalars['Int']['output']>;
  dir?: Maybe<Scalars['String']['output']>;
  ext?: Maybe<Scalars['String']['output']>;
  extension?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  ino?: Maybe<Scalars['Int']['output']>;
  mode?: Maybe<Scalars['Int']['output']>;
  modifiedTime?: Maybe<Scalars['String']['output']>;
  mtime?: Maybe<Scalars['String']['output']>;
  mtimeMs?: Maybe<Scalars['Int']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  nlink?: Maybe<Scalars['Int']['output']>;
  prettySize?: Maybe<Scalars['String']['output']>;
  rdev?: Maybe<Scalars['Int']['output']>;
  relativeDirectory?: Maybe<Scalars['String']['output']>;
  relativePath?: Maybe<Scalars['String']['output']>;
  root?: Maybe<Scalars['String']['output']>;
  size?: Maybe<Scalars['Int']['output']>;
  sourceInstanceName?: Maybe<Scalars['String']['output']>;
  uid?: Maybe<Scalars['Int']['output']>;
};

export type Query = {
  __typename?: 'Query';
  allBlogPost: Array<BlogPost>;
  allDirectory: Array<Directory>;
  allFile: Array<File>;
  blogPost?: Maybe<BlogPost>;
  directory?: Maybe<Directory>;
  file?: Maybe<File>;
};


export type QueryBlogPostArgs = {
  author?: InputMaybe<Scalars['String']['input']>;
  body?: InputMaybe<Scalars['String']['input']>;
  date?: InputMaybe<Scalars['String']['input']>;
  excerpt?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
};


export type QueryDirectoryArgs = {
  absolutePath?: InputMaybe<Scalars['String']['input']>;
  accessTime?: InputMaybe<Scalars['String']['input']>;
  atime?: InputMaybe<Scalars['String']['input']>;
  atimeMs?: InputMaybe<Scalars['Int']['input']>;
  base?: InputMaybe<Scalars['String']['input']>;
  birthTime?: InputMaybe<Scalars['String']['input']>;
  birthtime?: InputMaybe<Scalars['String']['input']>;
  birthtimeMs?: InputMaybe<Scalars['Int']['input']>;
  blksize?: InputMaybe<Scalars['Int']['input']>;
  blocks?: InputMaybe<Scalars['Int']['input']>;
  changeTime?: InputMaybe<Scalars['String']['input']>;
  ctime?: InputMaybe<Scalars['String']['input']>;
  ctimeMs?: InputMaybe<Scalars['Int']['input']>;
  dev?: InputMaybe<Scalars['Int']['input']>;
  dir?: InputMaybe<Scalars['String']['input']>;
  ext?: InputMaybe<Scalars['String']['input']>;
  extension?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  ino?: InputMaybe<Scalars['Int']['input']>;
  mode?: InputMaybe<Scalars['Int']['input']>;
  modifiedTime?: InputMaybe<Scalars['String']['input']>;
  mtime?: InputMaybe<Scalars['String']['input']>;
  mtimeMs?: InputMaybe<Scalars['Int']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  nlink?: InputMaybe<Scalars['Int']['input']>;
  prettySize?: InputMaybe<Scalars['String']['input']>;
  rdev?: InputMaybe<Scalars['Int']['input']>;
  relativeDirectory?: InputMaybe<Scalars['String']['input']>;
  relativePath?: InputMaybe<Scalars['String']['input']>;
  root?: InputMaybe<Scalars['String']['input']>;
  size?: InputMaybe<Scalars['Int']['input']>;
  sourceInstanceName?: InputMaybe<Scalars['String']['input']>;
  uid?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryFileArgs = {
  absolutePath?: InputMaybe<Scalars['String']['input']>;
  accessTime?: InputMaybe<Scalars['String']['input']>;
  atime?: InputMaybe<Scalars['String']['input']>;
  atimeMs?: InputMaybe<Scalars['Int']['input']>;
  base?: InputMaybe<Scalars['String']['input']>;
  birthTime?: InputMaybe<Scalars['String']['input']>;
  birthtime?: InputMaybe<Scalars['String']['input']>;
  birthtimeMs?: InputMaybe<Scalars['Int']['input']>;
  blksize?: InputMaybe<Scalars['Int']['input']>;
  blocks?: InputMaybe<Scalars['Int']['input']>;
  changeTime?: InputMaybe<Scalars['String']['input']>;
  ctime?: InputMaybe<Scalars['String']['input']>;
  ctimeMs?: InputMaybe<Scalars['Int']['input']>;
  dev?: InputMaybe<Scalars['Int']['input']>;
  dir?: InputMaybe<Scalars['String']['input']>;
  ext?: InputMaybe<Scalars['String']['input']>;
  extension?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  ino?: InputMaybe<Scalars['Int']['input']>;
  mode?: InputMaybe<Scalars['Int']['input']>;
  modifiedTime?: InputMaybe<Scalars['String']['input']>;
  mtime?: InputMaybe<Scalars['String']['input']>;
  mtimeMs?: InputMaybe<Scalars['Int']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  nlink?: InputMaybe<Scalars['Int']['input']>;
  prettySize?: InputMaybe<Scalars['String']['input']>;
  rdev?: InputMaybe<Scalars['Int']['input']>;
  relativeDirectory?: InputMaybe<Scalars['String']['input']>;
  relativePath?: InputMaybe<Scalars['String']['input']>;
  root?: InputMaybe<Scalars['String']['input']>;
  size?: InputMaybe<Scalars['Int']['input']>;
  sourceInstanceName?: InputMaybe<Scalars['String']['input']>;
  uid?: InputMaybe<Scalars['Int']['input']>;
};

export type PostCardFragment = { __typename?: 'BlogPost', id: string, slug?: string | null, title?: string | null, date?: string | null, author?: string | null, excerpt?: string | null } & { ' $fragmentName'?: 'PostCardFragment' };

export type GetPostQueryVariables = Exact<{
  slug?: InputMaybe<Scalars['String']['input']>;
}>;


export type GetPostQuery = { __typename?: 'Query', blogPost?: { __typename?: 'BlogPost', id: string, slug?: string | null, title?: string | null, date?: string | null, author?: string | null, body?: string | null } | null };

export type GetAllPostsQueryVariables = Exact<{ [key: string]: never; }>;


export type GetAllPostsQuery = { __typename?: 'Query', allBlogPost: Array<(
    { __typename?: 'BlogPost' }
    & { ' $fragmentRefs'?: { 'PostCardFragment': PostCardFragment } }
  )> };

export const PostCardFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PostCard"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BlogPost"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"date"}},{"kind":"Field","name":{"kind":"Name","value":"author"}},{"kind":"Field","name":{"kind":"Name","value":"excerpt"}}]}}]} as unknown as DocumentNode<PostCardFragment, unknown>;
export const GetPostDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetPost"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"slug"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"blogPost"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"slug"},"value":{"kind":"Variable","name":{"kind":"Name","value":"slug"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"date"}},{"kind":"Field","name":{"kind":"Name","value":"author"}},{"kind":"Field","name":{"kind":"Name","value":"body"}}]}}]}}]} as unknown as DocumentNode<GetPostQuery, GetPostQueryVariables>;
export const GetAllPostsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetAllPosts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"allBlogPost"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PostCard"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PostCard"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BlogPost"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"date"}},{"kind":"Field","name":{"kind":"Name","value":"author"}},{"kind":"Field","name":{"kind":"Name","value":"excerpt"}}]}}]} as unknown as DocumentNode<GetAllPostsQuery, GetAllPostsQueryVariables>;