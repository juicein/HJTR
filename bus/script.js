const ROUTE_LIST = document.getElementById("routeList");
const TYPE_FILTER = document.getElementById("typeFilter");
const REGION_FILTER = document.getElementById("regionFilter");

let routes = [];
let regionLogos = {};
let companyLogos = {};

Promise.all([
  fetch("../data/bus_data.txt").then(r => r.text()),
  fetch("../data/region_logos.json").then(r => r.json()),
  fetch("../data/company_logos.json").then(r => r.json())
]).then(([raw, rLogos, cLogos]) => {
  regionLogos = rLogos;
  companyLogos = cLogos;
  routes = parseBusData(raw);
  initRegionFilter(routes);
  render();
});

function parseBusData(text) {
  return text.trim().split("\n").map(line => {
    const name = line.match(/【(.+?)】/)?.[1];
    const company = line.match(/\{(.+?)\}/)?.[1];
    const region = line.match(/『(.+?)』/)?.[1];
    const color = line.match(/∮([0-9A-Fa-f]{6,8})∮/)?.[1];
    const isMetro = line.includes("θ地铁θ");

    const stopsPart = line.split("】")[1].split("-{")[0];
    const stops = stopsPart.split("-");

    return {
      name,
      company,
      region,
      color,
      type: isMetro ? "metro" : "bus",
      start: stops[0],
      end: stops[stops.length - 1]
    };
  });
}

function initRegionFilter(data) {
  const regions = [...new Set(data.map(r => r.region).filter(Boolean))];
  regions.forEach(r => {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = r;
    REGION_FILTER.appendChild(opt);
  });
}

TYPE_FILTER.onchange = REGION_FILTER.onchange = render;

function render() {
  ROUTE_LIST.innerHTML = "";
  routes
    .filter(r =>
      (TYPE_FILTER.value === "all" || r.type === TYPE_FILTER.value) &&
      (REGION_FILTER.value === "all" || r.region === REGION_FILTER.value)
    )
    .forEach(r => {
      const card = document.createElement("div");
      card.className = "route-card";
      if (r.color) card.style.borderLeftColor = `#${r.color}`;

      card.innerHTML = `
        <div class="route-title">${r.name}</div>
        <div class="route-sub">${r.start} → ${r.end}</div>
      `;
      ROUTE_LIST.appendChild(card);
    });
}
