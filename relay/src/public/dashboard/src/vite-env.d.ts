/// <reference types="vite/client" />

declare module '*.svg' {
  const content: string;
  export default content;
}

declare module 'react-vis-network-graph' {
  import { ComponentType } from 'react';
  const Graph: ComponentType<any>;
  export default Graph;
}
