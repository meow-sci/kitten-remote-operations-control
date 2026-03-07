const response = await fetch('http://localhost:7887/vehicle/data/current');
const data = await response.json();

console.log(JSON.stringify(data, null, 2));
