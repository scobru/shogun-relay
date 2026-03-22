import React, { useEffect, useRef } from "react";
import { Network, Options } from "vis-network";
import { DataSet } from "vis-data";

interface GraphProps {
  graph: {
    nodes: any[];
    edges: any[];
  };
  options?: Options;
  events?: {
    [event: string]: (params?: any) => void;
  };
}

const Graph: React.FC<GraphProps> = ({ graph, options, events }) => {
  const container = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);

  useEffect(() => {
    if (container.current) {
      const data = {
        nodes: new DataSet(graph.nodes),
        edges: new DataSet(graph.edges)
      };

      networkRef.current = new Network(container.current, data, options || {});

      if (events && networkRef.current) {
        Object.keys(events).forEach(eventName => {
          networkRef.current!.on(eventName as any, events[eventName]);
        });
      }
    }

    return () => {
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
      }
    };
  }, [graph, options, events]);

  return <div ref={container} style={{ height: "100%", width: "100%" }} />;
};

export default Graph;
