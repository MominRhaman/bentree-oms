import React, { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, doc, serverTimestamp, getDocs, query, orderBy, where } from 'firebase/firestore';
import { db } from './firebase'; // ADJUST PATH: Change this to match your Firebase config location
import OrderDetailsPopup from './components/OrderDetailsPopup'; // ADJUST PATH: Change to your component location
import { Package, Search, Filter, Plus, Eye, RotateCcw } from 'lucide-react';

const OrdersPage = () => {
  // State Management
  const [orders, setOrders] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isReturnMode, setIsReturnMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all'); // all, pending, dispatched, returned
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch Orders from Firebase
  const fetchOrders = async () => {
    try {
      setLoading(true);
      const ordersRef = collection(db, 'orders');
      const q = query(ordersRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);

      const ordersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setOrders(ordersData);
      // console.log(`Loaded ${ordersData.length} orders`);
    } catch (error) {
      console.error('Error fetching orders:', error);
      alert('Failed to load orders. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch Inventory from Firebase
  const fetchInventory = async () => {
    try {
      const inventoryRef = collection(db, 'inventory');
      const snapshot = await getDocs(inventoryRef);

      const inventoryData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setInventory(inventoryData);
      // console.log(`Loaded ${inventoryData.length} inventory items`);
    } catch (error) {
      console.error('Error fetching inventory:', error);
    }
  };

  // Load data on mount
  useEffect(() => {
    fetchOrders();
    fetchInventory();
  }, []);

  // Status Color Helper
  const getStatusColor = (status) => {
    const colors = {
      'Pending': 'bg-yellow-100 text-yellow-700 border-yellow-200',
      'Confirmed': 'bg-blue-100 text-blue-700 border-blue-200',
      'Dispatched': 'bg-purple-100 text-purple-700 border-purple-200',
      'Delivered': 'bg-green-100 text-green-700 border-green-200',
      'Returned': 'bg-red-100 text-red-700 border-red-200',
      'Cancelled': 'bg-gray-100 text-gray-700 border-gray-200'
    };
    return colors[status] || 'bg-gray-100 text-gray-700 border-gray-200';
  };

  // UPDATE EXISTING ORDER
  const handleOrderEdit = async (orderId, newStatus, orderData) => {
    try {
      const orderRef = doc(db, 'orders', orderId);
      await updateDoc(orderRef, {
        ...orderData,
        status: newStatus,
        updatedAt: serverTimestamp()
      });

      // console.log(' Order updated successfully:', orderId);

      // Refresh orders list
      await fetchOrders();
    } catch (error) {
      console.error('❌ Error updating order:', error);
      alert('Failed to update order. Please try again.');
      throw error;
    }
  };

  // CREATE NEW ORDER (for partial returns)
  const handleCreateOrder = async (orderData) => {
    try {
      const ordersRef = collection(db, 'orders');
      const docRef = await addDoc(ordersRef, {
        ...orderData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // console.log(' New return order created with ID:', docRef.id);

      // Refresh orders list to show the new return order
      await fetchOrders();

      return docRef.id;
    } catch (error) {
      console.error('❌ Error creating new order:', error);
      alert('Failed to create return order. Please try again.');
      throw error;
    }
  };

  // Filter orders based on active tab
  const filteredOrders = orders.filter(order => {
    // Search filter
    const matchesSearch = searchTerm === '' ||
      order.merchantOrderId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.storeOrderId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.recipientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.recipientPhone?.includes(searchTerm);

    // Tab filter
    let matchesTab = true;
    if (activeTab === 'pending') {
      matchesTab = order.status === 'Pending' || order.status === 'Confirmed';
    } else if (activeTab === 'dispatched') {
      matchesTab = order.status === 'Dispatched' || order.status === 'Delivered';
    } else if (activeTab === 'returned') {
      matchesTab = order.status === 'Returned' || order.status === 'Cancelled';
    }

    return matchesSearch && matchesTab;
  });

  // Open order details
  const openOrderDetails = (order, returnMode = false) => {
    setSelectedOrder(order);
    setIsReturnMode(returnMode);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3">
              <Package size={32} className="text-blue-600" />
              Orders Management
            </h1>
            <div className="text-sm text-gray-500">
              Total: <span className="font-bold text-gray-800">{orders.length}</span> orders
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Search by Order ID, Name, or Phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="bg-white rounded-lg shadow-md p-2 flex gap-2">
          {[
            { key: 'all', label: 'All Orders', count: orders.length },
            { key: 'pending', label: 'Pending', count: orders.filter(o => o.status === 'Pending' || o.status === 'Confirmed').length },
            { key: 'dispatched', label: 'Dispatched', count: orders.filter(o => o.status === 'Dispatched' || o.status === 'Delivered').length },
            { key: 'returned', label: 'Cancel & Return', count: orders.filter(o => o.status === 'Returned' || o.status === 'Cancelled').length }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-3 px-4 rounded-lg font-semibold transition-all ${activeTab === tab.key
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
            >
              {tab.label}
              <span className={`ml-2 px-2 py-1 rounded-full text-xs ${activeTab === tab.key ? 'bg-blue-500' : 'bg-gray-300'
                }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Orders List */}
      <div className="max-w-7xl mx-auto">
        {loading ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading orders...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <Package size={48} className="mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600 text-lg">No orders found</p>
            <p className="text-gray-400 text-sm mt-2">Try adjusting your filters or search terms</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredOrders.map(order => (
              <div
                key={order.id}
                className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow p-5 cursor-pointer border-l-4 border-blue-500"
              >
                <div className="flex items-center justify-between">
                  {/* Left: Order Info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold text-gray-800">
                        Order #{order.merchantOrderId || order.storeOrderId || 'N/A'}
                      </h3>
                      <span className={`text-xs px-3 py-1 rounded-full font-semibold border ${getStatusColor(order.status)}`}>
                        {order.status}
                      </span>
                      {order.isPartialReturn && (
                        <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-1 rounded-full border border-amber-200">
                          Partial Return
                        </span>
                      )}
                      {order.isExpress && (
                        <span className="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-1 rounded-full border border-purple-200">
                          Express
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-gray-600">
                      <div>
                        <p className="text-gray-400 text-xs">Customer</p>
                        <p className="font-medium text-gray-800">{order.recipientName}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs">Phone</p>
                        <p className="font-medium text-gray-800">{order.recipientPhone}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs">Items</p>
                        <p className="font-medium text-gray-800">{order.products?.length || 0} items</p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs">Total</p>
                        <p className="font-bold text-green-600">৳{order.grandTotal || 0}</p>
                      </div>
                    </div>

                    <p className="text-xs text-gray-400 mt-2">
                      Created: {new Date(order.createdAt?.seconds * 1000 || order.date).toLocaleString()}
                    </p>
                  </div>

                  {/* Right: Action Buttons */}
                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => openOrderDetails(order, false)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors flex items-center gap-2"
                    >
                      <Eye size={18} />
                      View
                    </button>

                    {(order.status === 'Dispatched' || order.status === 'Delivered') && (
                      <button
                        onClick={() => openOrderDetails(order, true)}
                        className="px-4 py-2 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 transition-colors flex items-center gap-2"
                      >
                        <RotateCcw size={18} />
                        Return
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ORDER DETAILS POPUP - WITH BOTH onEdit AND onCreate */}
      {selectedOrder && (
        <OrderDetailsPopup
          order={selectedOrder}
          onClose={() => {
            setSelectedOrder(null);
            setIsReturnMode(false);
          }}
          getStatusColor={getStatusColor}
          onEdit={handleOrderEdit}
          onCreate={handleCreateOrder} // THIS IS THE KEY PROP
          inventory={inventory}
          isReturnMode={isReturnMode}
        />
      )}
    </div>
  );
};

export default OrdersPage;