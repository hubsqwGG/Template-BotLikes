const axios = require('axios');
const fs = require('fs');
const path = require('path');

const PAYMENT_API_URL = process.env.PAYMENT_API_URL;
const PAYMENT_CLIENT_ID = process.env.PAYMENT_CLIENT_ID;
const PAYMENT_CLIENT_SECRET = process.env.PAYMENT_CLIENT_SECRET;
const PAYER_NAME = process.env.PAYER_NAME;
const PAYER_DOCUMENT = process.env.PAYER_DOCUMENT;

const PLANS = [
  { id: 'plan_3_dias', nome: '3 DIAS', valor: 6.0, limite: 50, dias: 3 },
  { id: 'plan_15_dias', nome: '15 DIAS', valor: 20.0, limite: 100, dias: 15 },
  { id: 'plan_30_dias', nome: '30 DIAS', valor: 30.0, limite: 150, dias: 30 },
  { id: 'plan_60_dias', nome: '60 DIAS', valor: 60.0, limite: 200, dias: 60 }
];

const PAYMENTS_FILE = path.join(__dirname, 'payments.json');
const PAYMENT_TIMEOUT = 20 * 60 * 1000;

class PaymentSystem {
  constructor() {
    this.activePayments = {};
    this.paymentCheckIntervals = {};
    this.loadPayments();
  }

  loadPayments() {
    try {
      if (fs.existsSync(PAYMENTS_FILE)) {
        const data = JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf8'));
        this.activePayments = data.activePayments || {};
        const now = Date.now();
        for (const paymentId in this.activePayments) {
          const payment = this.activePayments[paymentId];
          if (now - payment.createdAt > PAYMENT_TIMEOUT) {
            delete this.activePayments[paymentId];
          }
        }
        this.savePayments();
      }
    } catch (error) {
      this.activePayments = {};
    }
  }

  savePayments() {
    try {
      fs.writeFileSync(PAYMENTS_FILE, JSON.stringify({ activePayments: this.activePayments }, null, 2));
    } catch (error) {}
  }

  getPlanById(planId) {
    return PLANS.find(plan => plan.id === planId);
  }

  getAllPlans() {
    return PLANS;
  }

  generateTransactionId(userId, planId) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `fflikes_${userId}_${planId}_${timestamp}_${random}`;
  }

  async createPayment(userId, planId) {
    const plan = this.getPlanById(planId);
    if (!plan) throw new Error('Plano não encontrado');

    const transactionId = this.generateTransactionId(userId, planId);
    const payload = {
      amount: plan.valor,
      payerName: PAYER_NAME,
      payerDocument: PAYER_DOCUMENT,
      transactionId: transactionId,
      description: `Plano ${plan.nome}, UserId: ${userId}`
    };

    try {
      const response = await axios.post(`${PAYMENT_API_URL}/transactions/create`, payload, {
        headers: {
          'ci': PAYMENT_CLIENT_ID,
          'cs': PAYMENT_CLIENT_SECRET,
          'Content-Type': 'application/json'
        }
      });

      if (response.data && response.data.data) {
        const paymentData = response.data.data;
        this.activePayments[transactionId] = {
          transactionId, userId, planId,
          amount: plan.valor,
          copyPasteCode: paymentData.copyPaste || '',
          qrCodeUrl: paymentData.qrcodeUrl || '',
          status: 'PENDENTE',
          createdAt: Date.now(),
          lastCheck: Date.now()
        };
        this.savePayments();
        return {
          success: true,
          transactionId,
          copyPasteCode: paymentData.copyPaste || '',
          plan
        };
      } else {
        throw new Error('Resposta da API inválida');
      }
    } catch (error) {
      if (error.response) throw new Error(`Erro na API: ${error.response.data?.message || error.message}`);
      else throw new Error(`Erro de conexão: ${error.message}`);
    }
  }

  async checkPaymentStatus(transactionId) {
    const payment = this.activePayments[transactionId];
    if (!payment) return { success: false, error: 'Pagamento não encontrado' };

    try {
      const response = await axios.post(`${PAYMENT_API_URL}/transactions/check`, {
        transactionId: transactionId
      }, {
        headers: {
          'ci': PAYMENT_CLIENT_ID,
          'cs': PAYMENT_CLIENT_SECRET,
          'Content-Type': 'application/json'
        }
      });

      if (response.data && response.data.transaction) {
        const transaction = response.data.transaction;
        payment.status = transaction.transactionState;
        payment.lastCheck = Date.now();
        this.savePayments();
        return { success: true, status: transaction.transactionState, payment };
      } else {
        return { success: false, error: 'Resposta inválida da API' };
      }
    } catch (error) {
      if (error.response && error.response.status === 429) return { success: false, error: 'Rate limit excedido' };
      return { success: false, error: error.message };
    }
  }

  startPaymentMonitoring(transactionId, callback) {
    if (this.paymentCheckIntervals[transactionId]) clearInterval(this.paymentCheckIntervals[transactionId]);

    this.paymentCheckIntervals[transactionId] = setInterval(async () => {
      const payment = this.activePayments[transactionId];
      if (!payment) {
        clearInterval(this.paymentCheckIntervals[transactionId]);
        delete this.paymentCheckIntervals[transactionId];
        return;
      }

      const now = Date.now();
      if (now - payment.createdAt > PAYMENT_TIMEOUT) {
        this.cancelPayment(transactionId);
        callback({ status: 'TIMEOUT', payment });
        return;
      }

      const result = await this.checkPaymentStatus(transactionId);
      if (result.success && result.status === 'COMPLETO') {
        this.completePayment(transactionId);
        callback({ status: 'COMPLETO', payment });
      } else if (result.success && result.status === 'FALHA') {
        this.cancelPayment(transactionId);
        callback({ status: 'FALHA', payment });
      }
    }, 5000);
  }

  completePayment(transactionId) {
    const payment = this.activePayments[transactionId];
    if (payment) {
      payment.status = 'COMPLETO';
      payment.completedAt = Date.now();
      this.savePayments();
    }
    if (this.paymentCheckIntervals[transactionId]) {
      clearInterval(this.paymentCheckIntervals[transactionId]);
      delete this.paymentCheckIntervals[transactionId];
    }
  }

  cancelPayment(transactionId) {
    if (this.activePayments[transactionId]) {
      delete this.activePayments[transactionId];
      this.savePayments();
    }
    if (this.paymentCheckIntervals[transactionId]) {
      clearInterval(this.paymentCheckIntervals[transactionId]);
      delete this.paymentCheckIntervals[transactionId];
    }
  }

  getUserActivePayment(userId) {
    for (const transactionId in this.activePayments) {
      const payment = this.activePayments[transactionId];
      if (payment.userId === userId && payment.status === 'PENDENTE') return payment;
    }
    return null;
  }
}

module.exports = new PaymentSystem();