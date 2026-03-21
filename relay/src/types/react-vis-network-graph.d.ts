declare module "react-vis-network-graph" {
  import { Component } from "react";
  import { Network, NetworkEvents } from "vis-network";

  export interface GraphData {
    nodes: any[];
    edges: any[];
  }

  export interface GraphEvents {
    [event: string]: (params: any) => void;
  }

  export interface NetworkGraphProps {
    graph: GraphData;
    options?: any;
    events?: GraphEvents;
    getNetwork?: (network: Network) => void;
    identifier?: string;
    style?: React.CSSProperties;
    component?: string | React.ComponentType<any>;
  }

  export default class Graph extends Component<NetworkGraphProps> {}
}
