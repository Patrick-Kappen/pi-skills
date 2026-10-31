const componentBoundaries = [];
/* COMPONENT_BOUNDARY_RULES */

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: { path: ".+" },
      to: { circular: true },
    },
    ...componentBoundaries,
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
  },
};
