const vehicleId = process.argv[2] || 'vehicle-123';

const response = await fetch('http://localhost:7887/vehicle/actions/ignite', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    vehicleId,
  }),
});
const data = await response.json();

console.log(JSON.stringify(data, null, 2));
